// @vitest-environment node

/**
 * Switch item 2c (issue #110): the Pi text turn harness's contract, pinned
 * against the AI SDK runner's observable semantics — live deltas, history
 * shape, budget owners, refusal, failure classification (provider errors
 * throw; aborts are AbortError). The model call is a scripted double over a
 * real Pi AssistantMessageEventStream, so the event protocol consumed here
 * is the one production consumes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai';
import type { ModelMessage } from 'ai';

vi.mock('@iki/backend/runtimes/thread_summary', () => ({
  generateThreadSummary: vi.fn(),
}));

import { generateThreadSummary } from '@iki/backend/runtimes/thread_summary';
import {
  PiTextTurnHarness,
  type PiTextModelCall,
} from '@iki/backend/agent/runners/pi_text_turn_harness';
import type { HarnessConfig, TurnEvent, TurnInput } from '@iki/backend/agent/harness/harness_types';
import { RefusalError } from '@iki/backend/utils/errors';

const finalMessage = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text: 'scripted answer' }],
  api: 'openai-completions',
  provider: 'iki-custom',
  model: 'pi-model',
  usage: {
    input: 40,
    output: 20,
    cacheRead: 60,
    cacheWrite: 0,
    totalTokens: 120,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
  ...overrides,
});

type CapturedRequest = {
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  maxTokens?: number;
};

const scriptedModelCall = (
  events: AssistantMessageEvent[],
  final: AssistantMessage
): PiTextModelCall & { requests: CapturedRequest[] } => {
  const requests: CapturedRequest[] = [];
  const call = ((_config: unknown, request: {
    systemPrompt: string;
    messages: unknown[];
    maxTokens?: number;
  }) => {
    requests.push({
      systemPrompt: request.systemPrompt,
      messages: request.messages as CapturedRequest['messages'],
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: final });
    for (const event of events) stream.push(event);
    // Terminal event: error/aborted finals close with the error variant
    // (a later done push is a no-op — the stream is already complete).
    if (final.stopReason === 'error' || final.stopReason === 'aborted') {
      stream.push({ type: 'error', reason: final.stopReason, error: final });
    } else {
      stream.push({ type: 'done', reason: 'stop', message: final });
    }
    return stream;
  }) as PiTextModelCall & { requests: CapturedRequest[] };
  (call as unknown as { requests: CapturedRequest[] }).requests = requests;
  return call;
};

const textDelta = (delta: string): AssistantMessageEvent =>
  ({ type: 'text_delta', contentIndex: 0, delta, partial: finalMessage() }) as AssistantMessageEvent;
const thinkingDelta = (delta: string): AssistantMessageEvent =>
  ({ type: 'thinking_delta', contentIndex: 0, delta, partial: finalMessage() }) as AssistantMessageEvent;
const doneEvent = (message: AssistantMessage): AssistantMessageEvent =>
  ({ type: 'done', reason: 'stop', message }) as AssistantMessageEvent;
const errorEvent = (message: AssistantMessage): AssistantMessageEvent =>
  ({ type: 'error', reason: message.stopReason, error: message }) as AssistantMessageEvent;

const harnessConfig = (overrides: Partial<HarnessConfig> = {}): HarnessConfig =>
  ({
    providerType: 'custom-openai',
    providerId: 'provider_pi',
    model: 'pi-model',
    systemPrompt: 'you are scripted',
    enableTools: false,
    enabledToolNames: [],
    availableSkillIds: [],
    guardActive: false,
    maxIterations: 1,
    ...overrides,
  });

const collect = async (harness: PiTextTurnHarness, input: TurnInput) => {
  const events: TurnEvent[] = [];
  for await (const event of harness.turn(input)) events.push(event);
  return events;
};

const drainError = async (harness: PiTextTurnHarness, input: TurnInput) => {
  try {
    await collect(harness, input);
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('pi text turn harness (switch item 2c)', () => {
  beforeEach(() => {
    vi.mocked(generateThreadSummary).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams text deltas as message_update steps and completes with mapped usage', async () => {
    const modelCall = scriptedModelCall(
      [textDelta('Hello '), textDelta('world')],
      finalMessage()
    );
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });

    const steps = events.filter(e => e.event === 'step').map(e => e.step);
    expect(steps[0]).toEqual({ type: 'message_update', text: 'Hello ', kind: 'text' });
    expect(steps[1]).toEqual({ type: 'message_update', text: 'world', kind: 'text' });
    expect(steps.at(-1)).toMatchObject({ type: 'turn_end', outcome: 'completed', text: 'Hello world' });

    const done = events.at(-1);
    assert(done && done.event === 'done');
    expect(done.output.text).toBe('Hello world');
    // Total-prompt convention: 100 = 40 + 60 cached; unreported reasoning → 0.
    expect(done.output.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 60,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 120,
      estimatedCostUsd: 0,
    });
    expect(done.output.requiresApproval).toBe(false);
    expect(done.output.finishReason).toBe('stop');
    expect(done.output.lastStepInputTokens).toBe(100);
    expect(done.output.perf).toMatchObject({ toolCalls: 0, steps: 1 });
  });

  it('keeps history ModelMessage-shaped: prompt appended, response appended, wire projects both', async () => {
    const modelCall = scriptedModelCall([textDelta('answer')], finalMessage({ content: [{ type: 'text', text: 'answer' }] }));
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });
    const history: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ];

    await collect(harness, { prompt: 'probe', history });

    const after = harness.getHistory();
    expect(after).toHaveLength(4);
    expect(after[0]).toEqual(history[0]);
    expect(after[1]).toEqual(history[1]);
    expect(after[2]).toEqual({ role: 'user', content: 'probe' });
    expect(after[3]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
    });

    // The wire projected the whole transcript; the config system prompt leads.
    expect(modelCall.requests).toHaveLength(1);
    expect(modelCall.requests[0].systemPrompt).toContain('you are scripted');
    const roles = modelCall.requests[0].messages.map(m => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user']);
  });

  it('does not append an empty user message over existing history (resume parity)', async () => {
    const modelCall = scriptedModelCall([textDelta('ok')], finalMessage({ content: [{ type: 'text', text: 'ok' }] }));
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });
    const history: ModelMessage[] = [{ role: 'user', content: 'prior' }];

    await collect(harness, { prompt: '   ', history });

    expect(harness.getHistory()).toHaveLength(2);
    // No empty user message on the wire either — the request is the history.
    const roles = modelCall.requests[0].messages.map(m => m.role);
    expect(roles).toEqual(['user']);
  });

  it('maps thinking deltas to reasoning steps and the thinking block to a reasoning history part', async () => {
    const final = finalMessage({
      content: [
        { type: 'thinking', thinking: 'because' },
        { type: 'text', text: 'answer' },
      ],
    });
    const modelCall = scriptedModelCall(
      [thinkingDelta('bec'), thinkingDelta('ause'), textDelta('answer')],
      final
    );
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const steps = events.filter(e => e.event === 'step').map(e => e.step);
    expect(steps[0]).toEqual({ type: 'message_update', text: 'bec', kind: 'reasoning' });
    expect(steps[1]).toEqual({ type: 'message_update', text: 'ause', kind: 'reasoning' });
    expect(steps[2]).toEqual({ type: 'message_update', text: 'answer', kind: 'text' });

    expect(harness.getHistory().at(-1)).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'because' },
        { type: 'text', text: 'answer' },
      ],
    });
  });

  it('surfaces provider failures as a throw — never an empty-text success', async () => {
    const modelCall = scriptedModelCall(
      [errorEvent(finalMessage({ stopReason: 'error', errorMessage: 'upstream 503', content: [] }))],
      finalMessage({ stopReason: 'error', errorMessage: 'upstream 503', content: [] })
    );
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });

    const error = await drainError(harness, { prompt: 'probe' });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('upstream 503');
    // The turn's prompt stays in history (recovery parity); no assistant
    // message is invented for the failed call.
    expect(harness.getHistory()).toEqual([{ role: 'user', content: 'probe' }]);
  });

  it('classifies aborted streams as AbortError for the driver cancel/steer contract', async () => {
    const modelCall = scriptedModelCall(
      [errorEvent(finalMessage({ stopReason: 'aborted', errorMessage: 'Request was aborted', content: [] }))],
      finalMessage({ stopReason: 'aborted', errorMessage: 'Request was aborted', content: [] })
    );
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });

    const error = await drainError(harness, { prompt: 'probe' });
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('refuses an empty response with no tool calls (runner parity)', async () => {
    const modelCall = scriptedModelCall([], finalMessage({ content: [] }));
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });

    const error = await drainError(harness, { prompt: 'probe' });
    expect(error).toBeInstanceOf(RefusalError);
  });

  it('rejects a pre-aborted signal before any model call', async () => {
    const modelCall = scriptedModelCall([textDelta('never')], finalMessage());
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });
    const controller = new AbortController();
    controller.abort();

    const error = await drainError(harness, { prompt: 'probe', abortSignal: controller.signal });
    expect((error as DOMException).name).toBe('AbortError');
    expect(modelCall.requests).toHaveLength(0);
  });

  it('enforces the input budget with the shared owners: compact + summarize, then project', async () => {
    vi.mocked(generateThreadSummary).mockResolvedValue({
      summary: 'compacted summary',
      model: {} as never,
    });
    const longText = 'x'.repeat(4000);
    const modelCall = scriptedModelCall([textDelta('ok')], finalMessage({ content: [{ type: 'text', text: 'ok' }] }));
    const harness = new PiTextTurnHarness(
      harnessConfig({ maxInputTokens: 200 }),
      { modelCall }
    );
    const history: ModelMessage[] = [
      { role: 'user', content: longText },
      { role: 'assistant', content: [{ type: 'text', text: 'long reply' }] },
    ];

    await collect(harness, { prompt: 'current', history });

    expect(generateThreadSummary).toHaveBeenCalledTimes(1);
    const summaryInput = vi.mocked(generateThreadSummary).mock.calls[0][0];
    expect(JSON.stringify(summaryInput.messages)).toContain(longText.slice(0, 32));
    // The wire carries the summary system block and the protected tail, not
    // the omitted prefix.
    expect(modelCall.requests[0].systemPrompt).toContain('Earlier conversation summary:\ncompacted summary');
    const wireText = JSON.stringify(modelCall.requests[0].messages);
    expect(wireText).not.toContain(longText.slice(0, 64));
    expect(wireText).toContain('current');
  });

  it('throws when protected instructions alone exceed the budget (runner parity)', async () => {
    const modelCall = scriptedModelCall([textDelta('never')], finalMessage());
    const harness = new PiTextTurnHarness(
      harnessConfig({ maxInputTokens: 5, systemPrompt: 'system overhead' }),
      { modelCall }
    );

    const error = await drainError(harness, { prompt: 'a current prompt that alone is too long for the budget' });
    expect((error as Error).message).toContain('Context budget exceeded');
    expect(modelCall.requests).toHaveLength(0);
  });

  it('records the model inference fact onto the run row surface', async () => {
    const final = finalMessage();
    const modelCall = scriptedModelCall([textDelta('scripted answer')], final);
    const harness = new PiTextTurnHarness(harnessConfig(), { modelCall });
    const onInference = vi.fn();

    await collect(harness, { prompt: 'probe', onInference });

    expect(onInference).toHaveBeenCalledTimes(1);
    const record = onInference.mock.calls[0][0];
    expect(record.systemPrompt).toContain('you are scripted');
    expect(record.finishReason).toBe('stop');
    expect(record.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(record.messages.at(-1)).toEqual({ role: 'user', content: 'probe' });
  });
});

function assert(condition: unknown, message = 'assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}
