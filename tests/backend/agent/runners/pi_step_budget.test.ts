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
  withPiRetry,
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

/** Wire sanity: every toolResult on the wire is preceded by its assistant
 * toolCall — an orphaned toolResult is the signature of a mis-spliced
 * compaction (providers 400 it; lenient ones run corrupted context). */
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

    // Runner parity: the new summary REPLACES the prior one on the wire —
    // no accumulation. The protected turn prompt survives; step one's output
    // is summarized away, step two's is the kept tail.
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

    // Compaction 1 at turn start; the mid-turn compaction chains its text —
    // the old code started the chain from scratch (existingSummary undefined).
    expect(summarize).toHaveBeenCalledTimes(2);
    const secondCall = summarize.mock.calls[1][0] as { existingSummary?: string };
    expect(secondCall.existingSummary).toContain('Earlier conversation summary');

    // No-transcript-system shape: the turn-start summary rode the assembled
    // system prompt (first system → slot); after the mid-turn re-compaction
    // the summaries live as MESSAGES and the stale one must leave the system
    // prompt — the wire carries the new summary exactly once.
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

    // Two systems in the view at compaction time: the handoff text (first →
    // systemPrompt slot) and the turn-start summary (second → transcript
    // entry). This is the shape whose leading entry in MESSAGES broke the
    // count-based splice (round-1 finding c).
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

    // The handoff system stays EXACTLY once — in the assembled system prompt
    // (never duplicated into the messages by the rebuild); the summary rides
    // as a message; the wire stays paired.
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

    // Production shape from prior AI SDK turns: one `tool` ModelMessage
    // grouping N tool results (the projection expands each part into its own
    // wire entry — a count-based splice under-deletes exactly here).
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
            { type: 'tool-result', toolCallId: 't_a', toolName: TOOL_NAME, output: { type: 'text', value: 'a' } },
            { type: 'tool-result', toolCallId: 't_b', toolName: TOOL_NAME, output: { type: 'text', value: 'b' } },
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

  it('over-length rescue composes: the retry wrapper force-compacts through the harness and the fresh attempt reads the rebuilt transcript (#124)', async () => {
    summarize.mockResolvedValue({ summary: 'summary#overflow of the omitted prefix' });
    const capturedViews: string[] = [];
    let attempt = 0;
    // The production composition: the harness's modelCall surface hands the
    // wrapper its callbacks; the wrapper owns draining, classification and
    // the one-shot rescue; the attempts read the LIVE transcript (post-
    // compaction for the fresh attempt). Attempt 1 fails transiently (a
    // recovery note joins the transcript and pendingNotes), attempt 2 is
    // rejected for context length — the rescue must compact AND carry the
    // note onto the rebuilt wire.
    const modelCall: PiToolModelCall = (config, request) => {
      return withPiRetry(
        () => {
          attempt += 1;
          capturedViews.push(JSON.stringify(request.messages));
          if (attempt === 1) {
            return {
              stream: (async function* () {
                /* rejected before any content */
              })(),
              final: Promise.resolve(
                finalMessage({
                  content: [],
                  stopReason: 'error',
                  errorMessage: 'upstream 503',
                })
              ),
            };
          }
          if (attempt === 2) {
            return {
              stream: (async function* () {
                /* rejected before any content */
              })(),
              final: Promise.resolve(
                finalMessage({
                  content: [],
                  stopReason: 'error',
                  errorMessage: 'This model supports a maximum context length of 100 tokens',
                })
              ),
            };
          }
          const stream = createAssistantMessageEventStream();
          stream.push({ type: 'start', partial: finalMessage() });
          stream.push({
            type: 'done',
            reason: 'stop',
            message: finalMessage({ content: [textBlock('rescued')] }),
          });
          return {
            stream: stream as unknown as AsyncIterable<{ type: 'text_delta' | 'thinking_delta'; delta: string }>,
            events: (async function* () {
              /* no deltas */
            })(),
            final: stream.result(),
          };
        },
        request,
        request.onRecoveryNote,
        request.onContextOverflow
      );
    };
    const harness = new PiToolTurnHarness(budgetConfig(600), { modelCall });

    const { events, records } = await collect(harness, {
      prompt: 'go',
      history: [
        { role: 'user', content: OLD_TEXT },
        { role: 'assistant', content: 'ok' },
      ],
    });

    expect(attempt).toBe(3);
    const lastDone = events.at(-1);
    expect(lastDone).toMatchObject({ event: 'done' });
    expect(lastDone && lastDone.event === 'done' ? lastDone.output.text : '').toBe('rescued');
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summarize.mock.calls[0][0])).toContain(OLD_TEXT);
    // Attempt 1's wire still carried the full view; attempt 2 carried the
    // recovery note; the fresh attempt reads the rebuilt (compacted)
    // transcript WITH the recovery note — the rescue must not drop it.
    expect(capturedViews[0]).toContain(OLD_TEXT);
    expect(capturedViews[1]).toContain('Your last attempt encountered an error');
    expect(capturedViews[2]).toContain('summary#overflow');
    expect(capturedViews[2]).toContain('Your last attempt encountered an error');
    expect(capturedViews[2]).not.toContain(OLD_TEXT);
    // The stored mirror keeps the full text; the snapshot follows the send.
    expect(JSON.stringify(harness.getHistory())).toContain(OLD_TEXT);
    expect(JSON.stringify(records.at(-1)?.messages ?? '')).not.toContain(OLD_TEXT);
  }, 30000);
});
