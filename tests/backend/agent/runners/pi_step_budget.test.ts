// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';

const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getProviderConfig: vi.fn(() => ({
      id: 'provider_pi',
      type: 'custom-openai',
      apiKey: 'unit-key',
      baseURL: 'http://127.0.0.1:9/v1',
      models: ['pi-model'],
      modelOptions: {},
      isResponseApi: false,
    })),
  };
});

const summarize = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/runtimes/thread_summary', () => ({
  generateThreadSummary: summarize,
}));

import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { AgentHarness, startPiTurnHarness } from '@iki/backend/agent/harness';
import {
  PiToolTurnHarness,
  withPiRetry,
  type PiToolModelCall,
} from '@iki/backend/agent/runners/pi_tool_turn_harness';
import type { HarnessConfig, TurnEvent, TurnInput } from '@iki/backend/agent/harness/harness_types';

const TOOL_NAME = 'probe_budget';

const OLD_TEXT = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '.repeat(30);
const STEP_ONE_TEXT = 'alpha beta gamma delta epsilon zeta eta theta iota kappa '.repeat(25);
const STEP_TWO_TEXT = 'one two three four five six seven eight nine ten eleven twelve '.repeat(20);

const finalMessage = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text: 'scripted answer' }],
  api: 'openai-completions',
  provider: 'iki-custom',
  model: 'pi-model',
  usage: {
    input: 40,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 60,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
  ...overrides,
});

const textBlock = (text: string) => ({ type: 'text' as const, text });
const toolCallBlock = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({
  type: 'toolCall' as const,
  id,
  name,
  arguments: args as ToolCall['arguments'],
});

type CapturedRequest = {
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
};

const scriptedModelCall = (
  steps: Array<{ content: AssistantMessage['content']; deltas?: string[] }>
): PiToolModelCall & { requests: CapturedRequest[] } => {
  const requests: CapturedRequest[] = [];
  let attempts = 0;
  const call = ((
    _config: unknown,
    request: {
      systemPrompt: string;
      messages: unknown[];
    }
  ) => {
    requests.push({
      systemPrompt: request.systemPrompt,
      messages: request.messages as CapturedRequest['messages'],
    });
    const step = steps[attempts];
    if (!step) throw new Error(`unexpected model call #${attempts + 1}`);
    attempts += 1;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: finalMessage() });
    for (const delta of step.deltas ?? []) {
      stream.push({
        type: 'text_delta',
        contentIndex: 0,
        delta,
        partial: finalMessage(),
      } as AssistantMessageEvent);
    }
    stream.push({ type: 'done', reason: 'stop', message: finalMessage({ content: step.content }) });
    return {
      events: (async function* () {
        for await (const event of stream) {
          if ((event.type === 'text_delta' || event.type === 'thinking_delta') && event.delta) {
            yield { type: event.type, delta: event.delta };
          }
        }
      })(),
      final: stream.result(),
    };
  }) as unknown as PiToolModelCall & { requests: CapturedRequest[] };
  (call as unknown as { requests: CapturedRequest[] }).requests = requests;
  return call;
};

const budgetConfig = (maxInputTokens: number): HarnessConfig => ({
  providerType: 'custom-openai' as const,
  providerId: 'provider_pi',
  model: 'pi-model',
  systemPrompt: 'tool mode prompt',
  enableTools: true,
  enabledToolNames: [TOOL_NAME],
  availableSkillIds: [],
  guardActive: false,
  requireApproval: false,
  autoApproveToolRequests: false,
  approvalPolicy: 'never' as const,
  maxIterations: 4,
  maxInputTokens,
});

const collect = async (harness: PiToolTurnHarness, input: TurnInput) => {
  const events: TurnEvent[] = [];
  const records: Array<{ messages: unknown }> = [];
  for await (const event of harness.turn({
    ...input,
    onInference: record => records.push({ messages: record.messages }),
  })) {
    events.push(event);
  }
  return { events, records };
};

const expectToolPairsAligned = (messages: CapturedRequest['messages']) => {
  const calledIds = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of (message.content as Array<{ type?: string; id?: string }>) ?? []) {
        if (part?.type === 'toolCall' && typeof part.id === 'string') calledIds.add(part.id);
      }
    } else if (message.role === 'toolResult') {
      const toolCallId = (message as { toolCallId?: string }).toolCallId;
      expect(calledIds.has(toolCallId ?? '')).toBe(true);
    }
  }
};

beforeEach(() => {
  summarize
    .mockReset()
    .mockImplementation(async (params: { messages: unknown[]; existingSummary?: string }) => ({
      summary: `summary#${summarize.mock.calls.length} of ${params.messages.length} messages${
        params.existingSummary ? ' (chained)' : ''
      }`,
    }));
  defaultToolRegistry.register(
    createTool({
      name: TOOL_NAME,
      type: 'fs',
      description: 'budget probe',
      paramSchema: z.object({}),
      handler: async () => 'probe result',
    })
  );
});

afterAll(() => {
  defaultToolRegistry.remove(TOOL_NAME);
});

describe('per-request budget compaction on the Pi tool harness (#122)', () => {
  it('compacts mid-turn when a step pushes the view over the threshold: request compacted, mirror full, snapshot switched', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock(STEP_ONE_TEXT), toolCallBlock('call_1', TOOL_NAME, {})] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    const { records } = await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'user', content: OLD_TEXT },
        { role: 'assistant', content: 'ok' },
      ],
    });

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summarize.mock.calls[0][0])).toContain(OLD_TEXT);

    expect(modelCall.requests).toHaveLength(2);
    expect(JSON.stringify(modelCall.requests[1]!.messages)).toContain(
      'Earlier conversation summary'
    );
    expect(JSON.stringify(modelCall.requests[1]!.messages)).not.toContain(OLD_TEXT);
    expect(JSON.stringify(modelCall.requests[1]!.messages)).toContain(STEP_ONE_TEXT);

    expect(JSON.stringify(harness.getHistory())).toContain(OLD_TEXT);

    expect(JSON.stringify(records[1]!.messages)).not.toContain(OLD_TEXT);
    expect(JSON.stringify(records[1]!.messages)).toContain('Earlier conversation summary');
  }, 30000);

  it('chains re-compactions within one turn: the second summary builds on the first', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock(STEP_ONE_TEXT), toolCallBlock('call_1', TOOL_NAME, {})] },
      { content: [textBlock(STEP_TWO_TEXT), toolCallBlock('call_2', TOOL_NAME, {})] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'user', content: OLD_TEXT },
        { role: 'assistant', content: 'ok' },
      ],
    });

    expect(summarize).toHaveBeenCalledTimes(2);
    const secondCall = summarize.mock.calls[1][0] as { existingSummary?: string };
    expect(secondCall.existingSummary).toContain('Earlier conversation summary');
    expect(secondCall.existingSummary).toContain('summary#1');

    expect(JSON.stringify(modelCall.requests[2]!.messages)).toContain('summary#2');
    expect(JSON.stringify(modelCall.requests[2]!.messages)).not.toContain('summary#1');
    expect(JSON.stringify(modelCall.requests[2]!.messages)).not.toContain(STEP_ONE_TEXT);
    expect(JSON.stringify(modelCall.requests[2]!.messages)).toContain(STEP_TWO_TEXT);
    expect(JSON.stringify(modelCall.requests[2]!.messages)).toContain('go');
    for (const request of modelCall.requests) expectToolPairsAligned(request.messages);
  }, 30000);

  it('refuses loudly when the view cannot fit even uncompacted (current turn alone over budget)', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock('x'.repeat(5000)), toolCallBlock('call_1', TOOL_NAME, {})] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    const events: TurnEvent[] = [];
    let error: unknown;
    try {
      for await (const event of harness.turn({ prompt: 'go', history: [] })) events.push(event);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Context budget exceeded');
    expect(modelCall.requests).toHaveLength(1);
  }, 30000);

  it('records the turn-start compacted view, not the full mirror, from the first snapshot', async () => {
    const modelCall = scriptedModelCall([{ content: [textBlock('done')] }]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    const { records } = await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'user', content: 'x'.repeat(4000) },
        { role: 'assistant', content: 'ok' },
      ],
    });

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(records[0]!.messages)).not.toContain('x'.repeat(500));
    expect(JSON.stringify(harness.getHistory())).toContain('x'.repeat(500));
    expect(JSON.stringify(modelCall.requests[0]!.messages)).not.toContain('x'.repeat(500));
  }, 30000);

  it('chains the turn-start summary into the first mid-turn compaction', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock(STEP_ONE_TEXT), toolCallBlock('call_1', TOOL_NAME, {})] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'user', content: 'x'.repeat(4000) },
        { role: 'assistant', content: 'ok' },
      ],
    });

    expect(summarize).toHaveBeenCalledTimes(2);
    const secondCall = summarize.mock.calls[1][0] as { existingSummary?: string };
    expect(secondCall.existingSummary).toContain('Earlier conversation summary');

    const second = modelCall.requests[1]!;
    expect(second.systemPrompt).not.toContain('Earlier conversation summary');
    expect(second.systemPrompt).toContain('persona prompt');
    expect(JSON.stringify(second.messages)).toContain('summary#2');
    expect(JSON.stringify(second.messages)).not.toContain('summary#1');
    expectToolPairsAligned(second.messages);
  }, 30000);

  it('keeps a leading transcript system AND a turn-start summary distinct across mid-turn compaction (handoff + summary shape)', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock(STEP_ONE_TEXT), toolCallBlock('call_1', TOOL_NAME, {})] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'system', content: '[HANDOFF CONTEXT] You are a fresh agent instance.' },
        { role: 'user', content: 'x'.repeat(4000) },
        { role: 'assistant', content: 'ok' },
      ],
    });

    expect(summarize).toHaveBeenCalledTimes(2);
    const second = modelCall.requests[1]!;
    const handoffOccurrences = second.systemPrompt.split('[HANDOFF CONTEXT]').length - 1;
    expect(handoffOccurrences).toBe(1);
    expect(JSON.stringify(second.messages)).not.toContain('[HANDOFF CONTEXT]');
    expect(JSON.stringify(second.messages)).toContain('summary#2');
    expect(JSON.stringify(second.messages)).not.toContain('summary#1');
    expect(second.systemPrompt).not.toContain('Earlier conversation summary');
    expectToolPairsAligned(second.messages);
  }, 30000);

  it('keeps a leading transcript system (handoff shape) intact across mid-turn compaction', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock(STEP_ONE_TEXT), toolCallBlock('call_1', TOOL_NAME, {})] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    const { records } = await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'system', content: '[HANDOFF CONTEXT] You are a fresh agent instance.' },
        { role: 'user', content: OLD_TEXT },
        { role: 'assistant', content: 'ok' },
      ],
    });

    const second = modelCall.requests[1]!;
    expect(second.systemPrompt).toContain('[HANDOFF CONTEXT]');
    expect(JSON.stringify(second.messages)).not.toContain('[HANDOFF CONTEXT]');
    expect(JSON.stringify(second.messages)).toContain('Earlier conversation summary');
    expect(JSON.stringify(second.messages)).not.toContain(OLD_TEXT);
    expectToolPairsAligned(second.messages);
    expect(JSON.stringify(records[1]!.messages)).not.toContain(OLD_TEXT);
  }, 30000);

  it('omits a multi-part tool message without orphaning its projected results', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock(STEP_ONE_TEXT), toolCallBlock('call_1', TOOL_NAME, {})] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    const { records } = await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'user', content: OLD_TEXT },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'working' },
            { type: 'tool-call', toolCallId: 't_a', toolName: TOOL_NAME, input: {} },
            { type: 'tool-call', toolCallId: 't_b', toolName: TOOL_NAME, input: {} },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 't_a',
              toolName: TOOL_NAME,
              output: { type: 'text', value: 'a' },
            },
            {
              type: 'tool-result',
              toolCallId: 't_b',
              toolName: TOOL_NAME,
              output: { type: 'text', value: 'b' },
            },
          ],
        },
      ],
    });

    const second = modelCall.requests[1]!;
    expect(JSON.stringify(second.messages)).toContain('Earlier conversation summary');
    expect(JSON.stringify(second.messages)).not.toContain(OLD_TEXT);
    for (const request of modelCall.requests) expectToolPairsAligned(request.messages);
    expect(JSON.stringify(records[1]!.messages)).not.toContain(OLD_TEXT);
  }, 30000);
});
