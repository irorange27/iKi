// @vitest-environment node

/**
 * Switch debt #122: the Pi tool harness's per-request budget cadence —
 * prepareStep parity with the AI SDK runner. Every model call re-checks the
 * input budget; over the threshold the REQUEST view compacts (summary
 * message replaces the omitted prefix, chained within the turn) while the
 * stored mirror keeps the full text, the snapshot basis switches to what
 * was actually sent, and a view that cannot fit even compacted refuses
 * loudly. A differential leg drives the SAME scenario through the AI SDK
 * harness (faux model) and asserts the same compaction invariants.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import type { ModelMessage } from 'ai';

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
      acpCommand: '',
      acpArgs: '',
      acpMcpServerIds: '',
      acpAuthMethodId: '',
      acpApiProviderId: '',
      acpModelMapping: '',
    })),
  };
});

const summarize = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/runtimes/thread_summary', () => ({
  generateThreadSummary: summarize,
}));

import { createAssistantMessageEventStream, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { AgentHarness, startTurnHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import {
  PiToolTurnHarness,
  type PiToolModelCall,
} from '@iki/backend/agent/runners/pi_tool_turn_harness';
import type {
  HarnessConfig,
  TurnEvent,
  TurnInput,
} from '@iki/backend/agent/harness/harness_types';

const TOOL_NAME = 'probe_budget';

// Sizes measured against the real BPE tokenizer with ~1.5x margin over the
// compaction threshold: maxInputTokens 600, overhead ≈ 32 → threshold ≈ 454,
// keep ≈ 284. The pre-turn old text (~302) starts UNDER the threshold; each
// step's output (~326/~312 on the wire) pushes the view over it, so the
// compaction lands mid-turn.
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
  const call = ((_config: unknown, request: {
    systemPrompt: string;
    messages: unknown[];
  }) => {
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
      stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: finalMessage() } as AssistantMessageEvent);
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

beforeEach(() => {
  summarize.mockReset().mockImplementation(async (params: { messages: unknown[]; existingSummary?: string }) => ({
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

    // Request 2 carried the compacted view: the summary replaced the omitted
    // prefix; the old text is gone from the WIRE. (On the old code the
    // second request still carried the full view — this assertion fails.)
    expect(modelCall.requests).toHaveLength(2);
    expect(JSON.stringify(modelCall.requests[1]!.messages)).toContain('Earlier conversation summary');
    expect(JSON.stringify(modelCall.requests[1]!.messages)).not.toContain(OLD_TEXT);
    expect(JSON.stringify(modelCall.requests[1]!.messages)).toContain(STEP_ONE_TEXT);

    // The stored mirror keeps the full text (compaction is request-scoped).
    expect(JSON.stringify(harness.getHistory())).toContain(OLD_TEXT);

    // The snapshot basis switched: the inference record reflects what was
    // actually sent, not the full mirror.
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

    // Request 3 carries the chained summaries; step one's output is
    // summarized away, step two's is the kept tail.
    expect(JSON.stringify(modelCall.requests[2]!.messages)).toContain('summary#2');
    expect(JSON.stringify(modelCall.requests[2]!.messages)).toContain('summary#1');
    expect(JSON.stringify(modelCall.requests[2]!.messages)).not.toContain(STEP_ONE_TEXT);
    expect(JSON.stringify(modelCall.requests[2]!.messages)).toContain(STEP_TWO_TEXT);
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
    // No second request: the turn refused instead of sending an over-budget
    // view. (On the old code there was no per-request check at all.)
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
    // The first snapshot is the compacted request view — the old code
    // snapshotted the full mirror here.
    expect(JSON.stringify(records[0]!.messages)).not.toContain('x'.repeat(500));
    expect(JSON.stringify(harness.getHistory())).toContain('x'.repeat(500));
    expect(JSON.stringify(modelCall.requests[0]!.messages)).not.toContain('x'.repeat(500));
  }, 30000);
});

describe('differential: the same scenario compacts on both supply paths', () => {
  it('AI SDK harness (faux) compacts per step with the same invariants', async () => {
    summarize.mockResolvedValue({ summary: 'summary#sdk of the omitted prefix' });
    const model = new FauxModelProvider([
      fauxToolCall(TOOL_NAME, {}, { textBefore: STEP_ONE_TEXT }),
      fauxText('done'),
    ]);
    const call = vi.spyOn(model, 'doStream');
    const harness = startTurnHarness({
      providerType: 'faux',
      model: 'test',
      modelFactory: () => model as never,
      systemPrompt: 'tool mode prompt',
      enableTools: true,
      enabledToolNames: [TOOL_NAME],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 4,
      maxInputTokens: 600,
    });

    for await (const _event of harness.turn({
      prompt: 'go',
      history: [
        { role: 'user', content: OLD_TEXT },
        { role: 'assistant', content: 'ok' },
      ],
      toolsOverride: [
        createTool({
          name: TOOL_NAME,
          type: 'fs',
          description: 'budget probe',
          paramSchema: z.object({}),
          handler: async () => 'probe result',
        }),
      ],
    })) {
      /* drain */
    }

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
    // Request 1 runs BEFORE any compaction (the view is under threshold at
    // the first step) and legitimately carries the old prefix; request 2 is
    // compacted.
    expect(JSON.stringify(call.mock.calls[0][0].prompt)).toContain(OLD_TEXT);
    expect(JSON.stringify(call.mock.calls[0][0].prompt)).not.toContain('summary#sdk');
    const [secondOptions] = call.mock.calls[1]!;
    expect(JSON.stringify(secondOptions.prompt)).toContain('Earlier conversation summary');
    expect(JSON.stringify(secondOptions.prompt)).toContain('summary#sdk');
    expect(JSON.stringify(secondOptions.prompt)).toContain('go');
    expect(JSON.stringify(secondOptions.prompt)).not.toContain(OLD_TEXT);
    expect(JSON.stringify(harness.getHistory())).toContain(OLD_TEXT);
  }, 30000);
});
