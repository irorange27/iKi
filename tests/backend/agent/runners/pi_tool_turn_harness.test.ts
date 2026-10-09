// @vitest-environment node

/**
 * Switch item 3a (issue #114): the Pi tool turn harness's contract — loop
 * events mapped 1:1 onto the TurnDriver protocol, inline execution through
 * the real registry (unknown names become error results), ModelMessage
 * mirror shape, terminal mapping (stop / tool-calls), and the never-approve
 * gate the routing relies on. Model call and executor are scripted doubles.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import type { ModelMessage } from 'ai';
import { z } from 'zod';

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

import { createAssistantMessageEventStream, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
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
  tools?: Array<{ name: string; parameters: unknown }>;
};

type ScriptedStep = { content: AssistantMessage['content']; deltas?: string[]; usage?: Record<string, number> };

const scriptedModelCall = (
  steps: ScriptedStep[]
): PiToolModelCall & { requests: CapturedRequest[] } => {
  const requests: CapturedRequest[] = [];
  let attempts = 0;
  const call = ((_config: unknown, request: {
    systemPrompt: string;
    messages: unknown[];
    tools?: Array<{ name: string; parameters: unknown }>;
  }) => {
    requests.push({
      systemPrompt: request.systemPrompt,
      messages: request.messages as CapturedRequest['messages'],
      ...(request.tools ? { tools: request.tools } : {}),
    });
    const step = steps[attempts];
    if (!step) throw new Error(`unexpected model call #${attempts + 1}`);
    attempts += 1;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: finalMessage() });
    for (const delta of step.deltas ?? []) {
      stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: finalMessage() } as AssistantMessageEvent);
    }
    stream.push({ type: 'done', reason: 'stop', message: finalMessage({ content: step.content, ...(step.usage ? { usage: { input: step.usage.input ?? 0, output: step.usage.output ?? 0, cacheRead: step.usage.cacheRead ?? 0, cacheWrite: 0, reasoning: 0, totalTokens: step.usage.totalTokens ?? 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}) }) });
    // The PiToolModelCall contract: a live delta stream + the final promise.
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

const harnessConfig = (overrides: Partial<HarnessConfig> = {}): HarnessConfig =>
  ({
    providerType: 'custom-openai',
    providerId: 'provider_pi',
    model: 'pi-model',
    systemPrompt: 'tool mode prompt',
    enableTools: true,
    enabledToolNames: ['probe_read'],
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    approvalPolicy: 'never',
    maxIterations: 4,
    ...overrides,
  });

const collect = async (harness: PiToolTurnHarness, input: TurnInput) => {
  const events: TurnEvent[] = [];
  for await (const event of harness.turn(input)) events.push(event);
  return events;
};

const drainError = async (harness: PiToolTurnHarness, input: TurnInput) => {
  try {
    await collect(harness, input);
  } catch (error) {
    return error;
  }
  return undefined;
};

const stepEvents = (events: TurnEvent[]) => events.filter(e => e.event === 'step').map(e => e.step);

describe('pi tool turn harness (switch item 3a)', () => {
  const registered: string[] = [];

  const registerProbe = (name: string, handler: (args: { path: string }) => Promise<unknown>) => {
    defaultToolRegistry.register(
      createTool({
        name,
        type: 'fs',
        description: 'probe tool',
        paramSchema: z.object({ path: z.string() }),
        handler,
      })
    );
    registered.push(name);
  };

  afterAll(() => {
    for (const name of registered) defaultToolRegistry.remove(name);
  });

  beforeEach(() => {
    if (!defaultToolRegistry.get('probe_read')) {
      registerProbe('probe_read', async args => `body of ${args.path}`);
    }
  });

  it('runs a tool step chain: live deltas, tool events around the effect, terminal mapping', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock('reading '), toolCallBlock('call_1', 'probe_read', { path: '/a.txt' })], deltas: ['reading '], usage: { input: 0, output: 0, totalTokens: 0 } },
      { content: [textBlock('all done')], deltas: ['all done'], usage: { input: 20, output: 4, cacheRead: 60, totalTokens: 24 } },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const steps = stepEvents(events);

    expect(steps[0]).toEqual({ type: 'message_update', text: 'reading ', kind: 'text' });
    expect(steps[1]).toMatchObject({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName: 'probe_read',
      input: { path: '/a.txt' },
    });
    expect(steps[2]).toMatchObject({
      type: 'tool_execution_end',
      toolCallId: 'call_1',
      outcome: 'success',
      output: { type: 'text', value: 'body of /a.txt' },
    });
    expect(steps[3]).toEqual({ type: 'message_update', text: 'all done', kind: 'text' });
    expect(steps.at(-1)).toMatchObject({ type: 'turn_end', outcome: 'completed' });

    const done = events.at(-1);
    assert(done && done.event === 'done');
    expect(done.output.text).toBe('reading all done');
    expect(done.output.finishReason).toBe('stop');
    expect(done.output.requiresApproval).toBe(false);
    expect(done.output.toolCalls).toEqual([
      {
        toolName: 'probe_read',
        args: { path: '/a.txt' },
        result: { type: 'text', value: 'body of /a.txt' },
      },
    ]);
    // Total-prompt convention: 80 = 20 + 60 cached.
    expect(done.output.usage).toMatchObject({ inputTokens: 80, outputTokens: 4 });
    expect(done.output.perf).toMatchObject({ toolCalls: 1, steps: 2 });
  });

  it('mirrors the trajectory as ModelMessage parts: assistant once per step, tool results after effects', async () => {
    const modelCall = scriptedModelCall([
      { content: [toolCallBlock('call_m', 'probe_read', { path: '/m.txt' })] },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });

    await collect(harness, { prompt: 'probe' });

    const history = harness.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', content: 'probe' });
    // ONE assistant entry carrying the tool call (the B1 shape); this step
    // streamed no text, so the entry is the tool call alone.
    expect(history[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_m', toolName: 'probe_read', input: { path: '/m.txt' } },
      ],
    });
    expect(history[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_m',
          toolName: 'probe_read',
          output: { type: 'text', value: 'body of /m.txt' },
        },
      ],
    });
    expect(history[3]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
    });
    // The second request's transcript carried the assistant + tool result.
    expect(modelCall.requests).toHaveLength(2);
    expect(modelCall.requests[1].messages.map(m => m.role)).toEqual(['user', 'assistant', 'toolResult']);
    // The wire carried the projected tool schemas.
    expect(modelCall.requests[0].tools?.map(t => t.name)).toContain('probe_read');
    expect(modelCall.requests[0].systemPrompt).toContain('persona prompt');
  });

  it('parallel tool calls in one step: both execute, one assistant entry, two results', async () => {
    const modelCall = scriptedModelCall([
      {
        content: [
          toolCallBlock('call_p1', 'probe_read', { path: '/1.txt' }),
          toolCallBlock('call_p2', 'probe_read', { path: '/2.txt' }),
        ],
      },
      { content: [textBlock('both')] },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const starts = stepEvents(events).filter(s => s.type === 'tool_execution_start');
    expect(starts.map(s => (s as { toolCallId: string }).toolCallId)).toEqual(['call_p1', 'call_p2']);

    const history = harness.getHistory();
    expect(history[1]).toMatchObject({ role: 'assistant' });
    expect((history[1].content as Array<{ type: string }>).filter(p => p.type === 'tool-call')).toHaveLength(2);
    expect(history.filter(m => m.role === 'tool')).toHaveLength(2);
  });

  it('maps thinking deltas to reasoning and thinking blocks to reasoning parts', async () => {
    // The scripted stream has no thinking events; the thinking block on the
    // final message still mirrors as a reasoning part.
    const modelCall = scriptedModelCall([
      {
        content: [{ type: 'thinking' as const, thinking: 'pondering' }, textBlock('answer')],
        deltas: ['answer'],
      },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ enabledToolNames: [] }), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    expect(stepEvents(events)[0]).toEqual({ type: 'message_update', text: 'answer', kind: 'text' });
    const last = harness.getHistory().at(-1)!;
    expect(last.content).toEqual([
      { type: 'reasoning', text: 'pondering' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('budget exhaustion: the last step’s tools run, then done reports tool-calls with the pending calls', async () => {
    const modelCall = scriptedModelCall([
      { content: [toolCallBlock('call_b', 'probe_read', { path: '/b.txt' })], usage: { input: 8, output: 2, totalTokens: 10 } },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ maxIterations: 1 }), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const done = events.at(-1);
    assert(done && done.event === 'done');
    expect(done.output.finishReason).toBe('tool-calls');
    expect(done.output.toolCalls).toHaveLength(1);
    // The tool RAN (harness semantics) — the driver reports budget-exhausted.
    expect(stepEvents(events).filter(s => s.type === 'tool_execution_end')).toHaveLength(1);
  });

  it('refuses an empty response with no tool calls (runner parity)', async () => {
    const modelCall = scriptedModelCall([{ content: [] }]);
    const harness = new PiToolTurnHarness(harnessConfig({ enabledToolNames: [] }), { modelCall });

    const error = await drainError(harness, { prompt: 'probe' });
    expect(error).toBeInstanceOf(RefusalError);
  });

  it('executes through the real registry and reports unknown tool names as error results', async () => {
    const handled: string[] = [];
    registerProbe('probe_real', async args => {
      handled.push(args.path);
      return `real ${args.path}`;
    });
    const modelCall = scriptedModelCall([
      {
        content: [
          toolCallBlock('call_ok', 'probe_real', { path: '/real.txt' }),
          toolCallBlock('call_ghost', 'no_such_tool', { x: 1 }),
        ],
      },
      { content: [textBlock('done')] },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ enabledToolNames: ['probe_real'] }), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const ends = stepEvents(events).filter(s => s.type === 'tool_execution_end') as Array<{
      toolCallId: string;
      outcome: string;
      output?: { type: string; value?: string };
    }>;
    const byId = new Map(ends.map(e => [e.toolCallId, e]));
    expect(byId.get('call_ok')?.outcome).toBe('success');
    expect(handled).toEqual(['/real.txt']);
    // Unknown names are error results, never a crash.
    expect(byId.get('call_ghost')?.outcome).toBe('error');
    expect(byId.get('call_ghost')?.output?.value).toContain('Unknown tool');
  });

  it('records model inference per step in AI SDK part vocabulary with the sent snapshot', async () => {
    const modelCall = scriptedModelCall([
      { content: [toolCallBlock('call_i', 'probe_read', { path: '/i.txt' })], deltas: ['working '], usage: { input: 0, output: 0, totalTokens: 0 } },
      { content: [textBlock('done')], usage: { input: 20, output: 4, cacheRead: 60, totalTokens: 24 } },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });
    const onInference = vi.fn();

    await collect(harness, { prompt: 'probe', onInference });

    expect(onInference).toHaveBeenCalledTimes(2);
    const first = onInference.mock.calls[0][0];
    expect(first.finishReason).toBe('tool-calls');
    expect(first.content).toEqual([
      { type: 'tool-call', toolCallId: 'call_i', toolName: 'probe_read', input: { path: '/i.txt' } },
    ]);
    expect(first.messages.at(-1)).toEqual({ role: 'user', content: 'probe' });
    const second = onInference.mock.calls[1][0];
    expect(second.finishReason).toBe('stop');
    expect(second.usage).toMatchObject({ inputTokens: 80 });
    // The second step's snapshot includes the first step's exchange.
    expect(second.messages.map((m: ModelMessage) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('terminal tools (handoff): executed and carried in toolCalls, but off the execution-event surface', async () => {
    const modelCall = scriptedModelCall([
      {
        content: [toolCallBlock('call_h', 'handoff', { summary: 'handing over', next_steps: 'continue', reason: 'other' })],
      },
      { content: [textBlock('NEVER')] },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), {
      modelCall,
      executeTool: async () => ({ type: 'json', value: { summary: 'handing over' } }),
    });

    const events = await collect(harness, { prompt: 'probe' });
    const types = stepEvents(events).map(s => s.type);
    expect(types).toContain('turn_end');
    expect(types).not.toContain('tool_execution_start');
    expect(types).not.toContain('tool_execution_end');

    const done = events.at(-1);
    assert(done && done.event === 'done');
    // The driver's handoff branch reads the executed call from here.
    expect(done.output.toolCalls).toEqual([
      {
        toolName: 'handoff',
        args: { summary: 'handing over', next_steps: 'continue', reason: 'other' },
        result: { type: 'json', value: { summary: 'handing over' } },
      },
    ]);
    expect(modelCall.requests).toHaveLength(1);
    // The mirror still records the exchange: assistant with the call, then
    // the tool result (the loop stops right after the terminal step).
    const history = harness.getHistory();
    expect(history[1]).toMatchObject({ role: 'assistant' });
    expect(history.at(-1)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_h',
          toolName: 'handoff',
          output: { type: 'json', value: { summary: 'handing over' } },
        },
      ],
    });
  });

  it('lastStepInputTokens is the final step billed input, not the multi-step sum', async () => {
    const modelCall = scriptedModelCall([
      { content: [toolCallBlock('call_s', 'probe_read', { path: '/s.txt' })], usage: { input: 500, output: 10, totalTokens: 510 } },
      { content: [textBlock('done')], deltas: ['done'], usage: { input: 90, output: 5, cacheRead: 10, totalTokens: 100 } },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const done = events.at(-1);
    assert(done && done.event === 'done');
    // Cumulative usage sums (500+... plus 90+10), but the occupancy signal
    // is the FINAL request's billed input (90 + 10 cached).
    expect(done.output.usage.inputTokens).toBe(600);
    expect(done.output.lastStepInputTokens).toBe(100);
  });

  it('recovery notes join the mirror before the next assistant entry and ride the sent snapshot', async () => {
    // Attempt 1 fails transiently; the wrapper retries; the mirror must show
    // the note between the first exchange and the second assistant entry.
    // A wrapper-signaled recovery note (mirroring what withPiRetry does on a
    // retried step): the turn succeeds, and the note must sit between the
    // user input and the assistant entry in the stored trajectory.
    const modelCall: PiToolModelCall = (_config, request) => {
      request.onRecoveryNote?.('note: retrying after 503');
      return {
        events: (async function* () {
          yield { type: 'text_delta' as const, delta: 'recovered' };
        })(),
        final: Promise.resolve(finalMessage({ content: [textBlock('recovered')] })),
      };
    };
    const harness = new PiToolTurnHarness(harnessConfig({ enabledToolNames: [] }), { modelCall });
    const onInference = vi.fn();

    const events = await collect(harness, { prompt: 'probe', onInference });
    const done = events.at(-1);
    assert(done && done.event === 'done');
    expect(done.output.text).toBe('recovered');
    const history = harness.getHistory();
    expect(history[1]).toEqual({ role: 'user', content: expect.stringContaining('note: retrying') });
    expect(history[2]).toMatchObject({ role: 'assistant' });
    // This single call sent only the user input (the note was signaled
    // mid-call; a real retried step's note rides the NEXT request).
    expect(onInference.mock.calls[0][0].messages.map((m: ModelMessage) => m.role)).toEqual(['user']);
  });

  it('refuses toolsOverride and pre-aborted signals', async () => {
    const modelCall = scriptedModelCall([{ content: [textBlock('never')] }]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });
    const error = await drainError(harness, {
      prompt: 'probe',
      toolsOverride: [{ name: 'x' } as never],
    });
    expect((error as Error).message).toContain('toolsOverride');

    const controller = new AbortController();
    controller.abort();
    const abortError = await drainError(harness, { prompt: 'probe', abortSignal: controller.signal });
    expect((abortError as DOMException).name).toBe('AbortError');
    expect(modelCall.requests).toHaveLength(0);
  });

  it('pauses an always-policy turn: approval_request step, requiresApproval done, zero effects', async () => {
    const modelCall = scriptedModelCall([
      { content: [toolCallBlock('call_a', 'probe_read', { path: '/guarded.txt' })] },
      { content: [textBlock('NEVER')] },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ approvalPolicy: 'always' }), { modelCall });

    const events = await collect(harness, { prompt: 'probe' });
    const steps = stepEvents(events);
    const approvalStep = steps.find(s => s.type === 'approval_request') as {
      requests: Array<{ approvalId: string; toolCallId: string; toolCall: { toolName: string; args: unknown } }>;
    };
    expect(approvalStep.requests).toHaveLength(1);
    expect(approvalStep.requests[0]).toMatchObject({
      toolCallId: 'call_a',
      toolCall: { toolName: 'probe_read', args: { path: '/guarded.txt' } },
    });
    // No execution events: nothing ran before the decision.
    expect(steps.filter(s => s.type === 'tool_execution_start')).toHaveLength(0);

    const done = events.at(-1);
    assert(done && done.event === 'done');
    expect(done.output.requiresApproval).toBe(true);
    expect(done.output.toolApprovalRequests).toEqual(approvalStep.requests);
    // The mirror holds the assistant entry with the tool call — the paused
    // shape the resume pairs the decision against.
    expect(harness.getHistory().at(-1)).toMatchObject({ role: 'assistant' });
    expect(modelCall.requests).toHaveLength(1);
  });

  it('resume mode: decided calls execute through the injected owner, then the loop continues', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock('continuing after approval')], deltas: ['continuing'] },
    ]);
    const executed: Array<{ toolName: string; args: unknown; value?: unknown }> = [];
    const prepared: string[] = [];
    const pausedHistory: ModelMessage[] = [
      { role: 'user', content: 'probe' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_r', toolName: 'probe_read', input: { path: '/r.txt' } },
        ],
      },
    ];
    const harness = new PiToolTurnHarness(harnessConfig({ threadId: 'thread_resume' }), {
      modelCall,
      resume: {
        commands: [{ approvalId: 'ap_1', toolCallId: 'call_r', toolName: 'probe_read', args: { path: '/r.txt' } }],
        owner: {
          prepare: address => prepared.push(address.approvalId),
          executeApproved: async (address, port) => {
            assert(address.approvalId === 'ap_1');
            // The owner's port executes RAW (the owner wraps the result) —
            // record at this seam: the resume path bypasses deps.executeTool.
            const value = (await port.execute('probe_read', { path: '/r.txt' })) as string;
            executed.push({ toolName: 'probe_read', args: { path: '/r.txt' }, value });
            return {
              kind: 'completed',
              reused: false,
              result: { type: 'tool-result', toolCallId: 'call_r', toolName: 'probe_read', output: { type: 'text', value } },
            };
          },
        },
      },
    });

    const events = await collect(harness, { prompt: '', history: pausedHistory });

    const steps = stepEvents(events);
    expect(steps[0]).toMatchObject({
      type: 'tool_execution_start',
      toolCallId: 'call_r',
      toolName: 'probe_read',
    });
    expect(steps[1]).toMatchObject({ type: 'tool_execution_end', outcome: 'success' });
    expect(prepared).toEqual(['ap_1']);
    expect(executed).toEqual([
      { toolName: 'probe_read', args: { path: '/r.txt' }, value: 'body of /r.txt' },
    ]);

    const done = events.at(-1);
    assert(done && done.event === 'done');
    expect(done.output.requiresApproval).toBe(false);
    expect(done.output.finishReason).toBe('stop');

    // Mirror: user, assistant(tool-call), tool(result), assistant(final).
    const history = harness.getHistory();
    expect(history).toHaveLength(4);
    expect(history[1]).toMatchObject({ role: 'assistant' });
    expect(history[2]).toMatchObject({ role: 'tool' });
    expect(history[3]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'continuing after approval' }],
    });
    // The continuation request carried the tool result on the wire.
    expect(modelCall.requests[0].messages.map(m => m.role)).toEqual(['user', 'assistant', 'toolResult']);
  });

  it('resume mode: a denied call yields the owner canonical denial and the loop continues', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock('understood, skipping')], deltas: ['understood'] },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ threadId: 'thread_resume' }), {
      modelCall,
      resume: {
        commands: [{ approvalId: 'ap_d', toolCallId: 'call_d', toolName: 'probe_read', args: { path: '/d.txt' } }],
        owner: {
          prepare: () => undefined,
          executeApproved: async () => ({
            kind: 'completed' as const,
            reused: false,
            result: {
              type: 'tool-result' as const,
              toolCallId: 'call_d',
              toolName: 'probe_read',
              output: { type: 'execution-denied', reason: 'User rejected tool execution.' },
            },
          }),
        },
      },
    });

    const events = await collect(harness, { prompt: '', history: [
      { role: 'user', content: 'probe' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_d', toolName: 'probe_read', input: {} }] },
    ] as ModelMessage[] });

    const end = stepEvents(events).find(s => s.type === 'tool_execution_end') as {
      outcome: string;
      output?: { type: string };
    };
    expect(end.outcome).toBe('error');
    expect(end.output?.type).toBe('execution-denied');
    const done = events.at(-1);
    assert(done && done.event === 'done');
    // The streamed delta is the shown text (parity with the runner).
    expect(done.output.text).toBe('understood');
  });

  it('resume mode: unresolved owner outcomes fail loudly instead of inventing a result', async () => {
    const harness = new PiToolTurnHarness(harnessConfig({ threadId: 'thread_resume' }), {
      modelCall: scriptedModelCall([{ content: [textBlock('NEVER')] }]),
      resume: {
        commands: [{ approvalId: 'ap_u', toolCallId: 'call_u', toolName: 'probe_read', args: {} }],
        owner: {
          prepare: () => undefined,
          executeApproved: async () => ({ kind: 'unknown' }),
        },
      },
    });

    const error = await drainError(harness, { prompt: '', history: [
      { role: 'user', content: 'probe' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_u', toolName: 'probe_read', input: {} }] },
    ] as ModelMessage[] });
    expect((error as Error).message).toContain('could not be executed');
    expect((error as Error).message).toContain('unknown');
  });

  it('is reentrant: a second turn() (steer restart, batch continuation) rebuilds from its input over the first turn', async () => {
    const modelCall = scriptedModelCall([
      { content: [textBlock('first answer')], usage: { input: 10, output: 5, totalTokens: 15 } },
      { content: [textBlock('second answer')], usage: { input: 30, output: 5, totalTokens: 35 } },
    ]);
    const harness = new PiToolTurnHarness(harnessConfig(), { modelCall });

    const first = await collect(harness, { prompt: 'first prompt', history: [] });
    const firstDone = first.at(-1);
    assert(firstDone && firstDone.event === 'done');
    expect(firstDone.output.text).toBe('first answer');

    // The steer-restart / batch-continuation shape: the driver passes the
    // live history plus the appended input with an EMPTY prompt.
    const steerInput: ModelMessage = { role: 'user', content: '[STEERING INPUT] go left' };
    const second = await collect(harness, {
      prompt: '',
      history: [...harness.getHistory(), steerInput],
    });
    const secondDone = second.at(-1);
    assert(secondDone && secondDone.event === 'done');
    expect(secondDone.output.text).toBe('second answer');

    // The second request carried the full first-turn transcript plus the
    // steer entry — nothing lost across turns, no empty user message.
    const secondRequest = modelCall.requests[1]!;
    expect(secondRequest.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(secondRequest.messages[1])).toContain('first answer');
    expect(JSON.stringify(secondRequest.messages[2])).toContain('go left');
  });
});

describe('withPiRetry (the production wrapper)', () => {
  const baseRequest = () => ({
    messages: [{ role: 'user' as const, content: 'go', timestamp: Date.now() }] as never[],
  });

  const attemptFrom = (steps: Array<{ stopReason?: AssistantMessage['stopReason']; errorMessage?: string; deltas?: string[] }>) => {
    let n = 0;
    return () => {
      const step = steps[Math.min(n, steps.length - 1)];
      n += 1;
      return {
        stream: (async function* () {
          for (const delta of step.deltas ?? []) yield { type: 'text_delta' as const, delta };
        })(),
        final: Promise.resolve(
          finalMessage({
            content:
              step.stopReason === 'error' || step.stopReason === 'aborted' ? [] : [textBlock('ok')],
            stopReason: step.stopReason ?? 'stop',
            ...(step.errorMessage ? { errorMessage: step.errorMessage } : {}),
          })
        ),
      };
    };
  };

  it('retries a transient failure: retry deltas flow and the note is signaled', async () => {
    const notes: string[] = [];
    const request = baseRequest();
    const { events, final } = withPiRetry(
      attemptFrom([
        { stopReason: 'error', errorMessage: 'upstream 503' },
        { deltas: ['recovered '] },
      ]),
      request,
      note => notes.push(note)
    );
    const deltas: string[] = [];
    for await (const delta of events) deltas.push(delta.delta);
    const result = await final;
    expect(deltas.join('')).toBe('recovered ');
    expect(result.stopReason).toBe('stop');
    expect(notes).toHaveLength(1);
    // The note persisted onto the LIVE transcript.
    expect((request.messages as Array<{ content: string }>)[1].content).toContain('encountered an error');
  }, 15000);

  it('terminal content-filter failures throw the runner RefusalError', async () => {
    const { final } = withPiRetry(
      attemptFrom([{ stopReason: 'error', errorMessage: 'Provider finish_reason: content_filter' }]),
      baseRequest()
    );
    // Refusals ARE retryable (runner parity) — the refusal surfaces only
    // after the retry budget exhausts.
    await expect(final).rejects.toBeInstanceOf(RefusalError);
  }, 15000);

  it('does not retry once the failed call streamed anything', async () => {
    let attempts = 0;
    const { events, final } = withPiRetry(
      () => {
        attempts += 1;
        return attemptFrom([{ stopReason: 'error', errorMessage: 'upstream 503', deltas: ['partial'] }])();
      },
      baseRequest()
    );
    const deltas: string[] = [];
    for await (const delta of events) deltas.push(delta.delta);
    const result = await final;
    expect(attempts).toBe(1);
    expect(deltas.join('')).toBe('partial');
    expect(result.stopReason).toBe('error');
  });

  it('aborted signals surface as AbortError even during the terminal classification', async () => {
    const controller = new AbortController();
    controller.abort();
    const { final } = withPiRetry(
      attemptFrom([{ stopReason: 'error', errorMessage: 'Request was aborted' }]),
      { messages: [] as never[], signal: controller.signal }
    );
    await expect(final).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('compacts and retries once on a provider over-length rejection (#124)', async () => {
    const onOverflow = vi.fn(async () => undefined);
    const { final } = withPiRetry(
      attemptFrom([
        { stopReason: 'error', errorMessage: 'This model supports a maximum context length of 100 tokens' },
        { stopReason: 'stop' },
      ]),
      baseRequest(),
      undefined,
      onOverflow
    );
    const result = await final;
    expect(result.stopReason).toBe('stop');
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it('a second over-length rejection is terminal — no compaction loop', async () => {
    const onOverflow = vi.fn(async () => undefined);
    const { final } = withPiRetry(
      attemptFrom([{ stopReason: 'error', errorMessage: 'maximum context length exceeded' }]),
      baseRequest(),
      undefined,
      onOverflow
    );
    const result = await final;
    expect(result.stopReason).toBe('error');
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it('does not compact once the failed attempt streamed anything', async () => {
    const onOverflow = vi.fn(async () => undefined);
    const { final } = withPiRetry(
      attemptFrom([{ deltas: ['partial '], stopReason: 'error', errorMessage: 'context length exceeded' }]),
      baseRequest(),
      undefined,
      onOverflow
    );
    const result = await final;
    expect(result.stopReason).toBe('error');
    expect(onOverflow).not.toHaveBeenCalled();
  });

  it('without the callback an over-length failure stays terminal', async () => {
    const { final } = withPiRetry(
      attemptFrom([{ stopReason: 'error', errorMessage: 'context length exceeded' }]),
      baseRequest()
    );
    const result = await final;
    expect(result.stopReason).toBe('error');
  });

  it('an overflow rescue resets the transient retry budget for the fresh request', async () => {
    const onOverflow = vi.fn(async () => undefined);
    const onNote = vi.fn();
    const { final } = withPiRetry(
      attemptFrom([
        { stopReason: 'error', errorMessage: 'context length exceeded' },
        { stopReason: 'error', errorMessage: 'rate limit' },
        { stopReason: 'stop' },
      ]),
      baseRequest(),
      onNote,
      onOverflow
    );
    const result = await final;
    expect(result.stopReason).toBe('stop');
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledTimes(1);
  });
});

function assert(condition: unknown, message = 'assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}
