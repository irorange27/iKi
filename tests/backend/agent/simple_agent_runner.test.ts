import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Realistic AI SDK stream mocks ──────────────────────────────────────────
// These mocks simulate the AI SDK's actual two-layer stream architecture
// (inner step stream → outer fullStream + 5 independent deferred promises),
// which the existing test suite's trivial vi.fn() mocks do not capture.

const {
  streamTextMock,
  smoothStreamMock,
  stepCountIsMock,
  generateThreadSummaryMock,
} = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  smoothStreamMock: vi.fn(),
  stepCountIsMock: vi.fn(),
  generateThreadSummaryMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: streamTextMock,
  smoothStream: smoothStreamMock,
  stepCountIs: stepCountIsMock,
  hasToolCall: vi.fn(() => () => false),
}));

vi.mock('@iki/backend/runtimes/thread_summary', () => ({
  generateThreadSummary: generateThreadSummaryMock,
}));

// ── Factory mocks ──────────────────────────────────────────────────────────

const {
  createModelMock,
  disposeLanguageModelMock,
  getModelGenerationSettingsMock,
  injectReasoningContentIntoMessagesMock,
} = vi.hoisted(() => ({
  createModelMock: vi.fn(),
  disposeLanguageModelMock: vi.fn(),
  getModelGenerationSettingsMock: vi.fn(() => ({})),
  injectReasoningContentIntoMessagesMock: vi.fn((msgs: unknown[]) => msgs),
}));

vi.mock('@iki/backend/provider/llm/factory', () => ({
  createModel: createModelMock,
  disposeLanguageModel: disposeLanguageModelMock,
  getModelGenerationSettings: getModelGenerationSettingsMock,
  injectReasoningContentIntoMessages: injectReasoningContentIntoMessagesMock,
  getFullSystemPrompt: vi.fn(() => 'You are a helpful assistant.'),
}));

vi.mock('@iki/backend/provider/llm/usage', () => ({
  normalizeLanguageModelUsage: vi.fn(
    (usage: Record<string, unknown> | undefined) => ({
      inputTokens: (usage as any)?.inputTokens ?? 0,
      outputTokens: (usage as any)?.outputTokens ?? 0,
      totalTokens: (usage as any)?.totalTokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
    }),
  ),
}));

// ── Config context mock (so loadAgentConfig works) ─────────────────────────

const { getAppConfigMock } = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(),
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

// ───────────────────────────────────────────────────────────────────────────

import { SimpleAgentRunner } from '@iki/backend/agent/runners/simple_agent_runner';
import { isRetryableError, RefusalError } from '@iki/backend/utils/errors';

// ── Helpers ────────────────────────────────────────────────────────────────

/** A value that looks like a Promise but is not a native Promise. */
class PromiseLike<T> {
  private _promise: Promise<T>;
  constructor(promise: Promise<T>) {
    this._promise = promise;
  }
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return new PromiseLike(this._promise.then(onfulfilled, onrejected));
  }
}

const fakeModel = { provider: 'test', modelId: 'test-model' };

const baseAgentConfig = {
  enabled: true,
  providerType: 'openai',
  providerId: '',
  model: 'gpt-4o-mini',
  systemPrompt: 'Test system prompt',
  temperature: 0.1,
  maxTokens: 2000,
  maxIterations: 5,
  enableTools: false,
  enableMemory: false,
};

interface StreamPart {
  type: string;
  [key: string]: unknown;
}

interface StreamTextResult {
  fullStream: AsyncIterable<StreamPart>;
  response: PromiseLike<{
    id: string;
    timestamp: Date;
    modelId: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  content: PromiseLike<Array<{ type: string; text?: string }>>;
  totalUsage: Promise<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
  finishReason: Promise<string>;
  steps: PromiseLike<Array<{ toolCalls?: unknown[]; text?: string }>>;
  toolCalls: Promise<Array<{ toolName: string; args: unknown }>>;
  text: Promise<string>;
}

const makePromiseLike = <T>(value: T): PromiseLike<T> =>
  new PromiseLike(Promise.resolve(value));

const makeRejectedPromiseLike = <T>(error: Error): PromiseLike<T> =>
  new PromiseLike(Promise.reject(error));

/**
 * Build a minimal but realistic streamText result.
 *
 * By default all promises resolve successfully. Callers can override
 * individual promises to simulate the partial-failure scenarios that
 * the real AI SDK produces (e.g. steps rejects while response succeeds).
 */
function makeStreamTextResult(overrides?: {
  fullStreamParts?: StreamPart[];
  responseMessages?: Array<{ role: string; content: string }>;
  rejectSteps?: Error;
  rejectTotalUsage?: Error;
  rejectFinishReason?: Error;
  contentParts?: Array<{ type: string; text?: string }>;
  steps?: Array<{ toolCalls?: unknown[]; text?: string }>;
  toolCalls?: Array<{ toolName: string; args: unknown }>;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}): StreamTextResult {
  const parts = overrides?.fullStreamParts ?? [
    { type: 'text-delta', text: 'Hello' },
    { type: 'finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 1 } },
  ];

  async function* fullStream(): AsyncIterable<StreamPart> {
    for (const part of parts) {
      yield part;
    }
  }

  return {
    fullStream: fullStream(),
    response: makePromiseLike({
      id: 'resp-1',
      timestamp: new Date(),
      modelId: 'test-model',
      messages: overrides?.responseMessages ?? [
        { role: 'assistant', content: 'Hello' },
      ],
    }),
    content: makePromiseLike(
      overrides?.contentParts ?? [{ type: 'text', text: 'Hello' }],
    ),
    totalUsage: overrides?.rejectTotalUsage
      ? Promise.reject(overrides.rejectTotalUsage)
      : Promise.resolve(
          overrides?.usage ?? { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
        ),
    finishReason: overrides?.rejectFinishReason
      ? Promise.reject(overrides.rejectFinishReason)
      : Promise.resolve(overrides?.finishReason ?? 'stop'),
    steps: overrides?.rejectSteps
      ? makeRejectedPromiseLike(overrides.rejectSteps)
      : makePromiseLike(
          overrides?.steps ?? [{ text: 'Hello', toolCalls: [] }],
        ),
    toolCalls: Promise.resolve(overrides?.toolCalls ?? []),
    text: Promise.resolve('Hello'),
  };
}

function setupStreamText(result: StreamTextResult) {
  streamTextMock.mockReturnValue(result);
  smoothStreamMock.mockReturnValue(undefined);
  stepCountIsMock.mockReturnValue(undefined);
}

function setupAgentConfig(overrides?: Record<string, unknown>) {
  getAppConfigMock.mockReturnValue({
    agent: { ...baseAgentConfig, ...overrides },
  });
}

function setupModel() {
  createModelMock.mockReturnValue(fakeModel);
}

function setupAll(result: StreamTextResult, configOverrides?: Record<string, unknown>) {
  setupStreamText(result);
  setupAgentConfig(configOverrides);
  setupModel();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SimpleAgentRunner — characterization tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModelGenerationSettingsMock.mockReturnValue({});
  });

  describe('stream failures', () => {
    it('fails partial output without replaying the attempt', async () => {
      setupAgentConfig();
      setupModel();
      streamTextMock.mockReturnValue(makeStreamTextResult({
        fullStreamParts: [
          { type: 'text-delta', text: 'partial' },
          { type: 'error', error: new Error('connection reset') },
        ],
      }));
      const consume = async () => {
        for await (const _step of new SimpleAgentRunner().run({
          config: { enabled: true }, prompt: 'test', tools: [], providerType: 'openai', model: 'test',
        })) { /* drain */ }
      };
      await expect(consume()).rejects.toThrow('connection reset');
      expect(streamTextMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('independent promise resolution (Bug 2: insufficient tool messages)', () => {
    it('preserves response.messages when steps rejects with NoOutputGeneratedError', async () => {
      const toolMessages = [
        {
          role: 'assistant' as const,
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'tc-1',
              toolName: 'read',
              input: { path: '/tmp/test' },
            },
          ],
        },
        {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: 'tc-1',
              toolName: 'read',
              output: 'file contents here',
            },
          ],
        },
      ];

      const result = makeStreamTextResult({
        fullStreamParts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'read',
            input: { path: '/tmp/test' },
          },
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'read',
            output: 'file contents here',
          },
          // No 'finish' part → outer flush rejects steps
        ],
        responseMessages: toolMessages,
        rejectSteps: Object.assign(
          new Error('AI_NoOutputGeneratedError: No output generated.'),
          { name: 'AI_NoOutputGeneratedError' },
        ),
        steps: [],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'read /tmp/test',
        tools: [
          {
            name: 'read',
            description: 'Read a file',
            handler: async () => 'file contents here',
          },
        ],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      const steps: unknown[] = [];
      for await (const step of gen) {
        steps.push(step);
      }
      await gen.next();

      // The runner should not have thrown — it should complete
      const finishStep = steps.find((s: any) => s.type === 'turn_end');
      expect(finishStep).toBeDefined();

      // History should contain the tool messages (not replaced with empty array)
      const history = runner.getHistory();
      const assistantWithToolCall = history.find(
        (m: any) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'tool-call'),
      );
      expect(assistantWithToolCall).toBeDefined();
    });

    it('preserves response.messages when totalUsage also rejects', async () => {
      const toolMessages = [
        { role: 'assistant' as const, content: 'Partial response without finish' },
      ];

      const noOutputErr = Object.assign(
        new Error('AI_NoOutputGeneratedError: No output generated.'),
        { name: 'AI_NoOutputGeneratedError' },
      );

      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'text-delta', text: 'Partial response without finish' },
          // No finish → both steps and totalUsage reject
        ],
        responseMessages: toolMessages,
        rejectSteps: noOutputErr,
        rejectTotalUsage: noOutputErr,
      });
      setupAll(result);

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      const steps: unknown[] = [];
      for await (const step of gen) {
        steps.push(step);
      }
      await gen.next();

      // Should complete (usage falls back to empty, response preserved)
      const finishStep = steps.find((s: any) => s.type === 'turn_end');
      expect(finishStep).toBeDefined();

      // Usage should be the empty default
      const usage = (finishStep as any)?.usage;
      expect(usage?.inputTokens).toBe(0);
      expect(usage?.outputTokens).toBe(0);
    });

    it('throws non-NoOutputGenerated errors from promise resolution', async () => {
      const fatalErr = new Error('Fatal provider error');
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'text-delta', text: 'ok' },
          { type: 'finish', finishReason: 'stop' },
        ],
        rejectSteps: fatalErr, // Not AI_NoOutputGeneratedError
      });
      setupAll(result);

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      // Should eventually throw because it exhausts retries
      await expect(async () => {
        for await (const _step of gen) {
          // consume
        }
      }).rejects.toThrow();
    });
  });

  describe('PromiseLike support', () => {
    it('handles PromiseLike (not Promise) from result.response and result.content', async () => {
      const result = makeStreamTextResult();
      // Verify our helpers actually return PromiseLike, not Promise
      expect(result.response).not.toBeInstanceOf(Promise);
      expect(result.content).not.toBeInstanceOf(Promise);

      setupAll(result);

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      for await (const _step of gen) {
        // consume
      }

      // Should have completed without error
      const history = runner.getHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('unhandled part types — resilience', () => {
    it('yields reasoning-delta and source steps, silently skips marker parts', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'text-start', id: 'txt-1' },
          { type: 'reasoning-delta', text: 'Let me think about this...' },
          { type: 'text-delta', text: 'Hello' },
          { type: 'source', sourceId: 'src-1', title: 'Example', url: 'https://example.com' },
          { type: 'tool-input-start', id: 'ti-1', toolName: 'read' },
          { type: 'tool-input-delta', delta: 'partial input' },
          { type: 'tool-input-end', id: 'ti-1' },
          { type: 'raw', data: 'raw provider event' },
          { type: 'finish', finishReason: 'stop' },
        ],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'test',
        tools: [
          {
            name: 'read',
            description: 'Read a file',
            handler: async () => 'contents',
          },
        ],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      const steps: unknown[] = [];
      for await (const step of gen) {
        steps.push(step);
      }
      await gen.next();

      // Reasoning content is now yielded as a step (was silently dropped before)
      const reasoningStep = steps.find((s: any) => s.type === 'message_update');
      expect(reasoningStep).toBeDefined();
      expect((reasoningStep as any)?.text).toBe('Let me think about this...');

      // Source citations are collected and attached to turn_end
      const finishStep = steps.find((s: any) => s.type === 'turn_end');
      expect(finishStep).toBeDefined();
      const sources = (finishStep as any)?.sources;
      expect(sources).toBeDefined();
      expect(sources[0]?.sourceId).toBe('src-1');
      expect(sources[0]?.url).toBe('https://example.com');

      // Marker parts should still be skipped (no crash)
      expect(finishStep).toBeDefined();
    });
  });

  describe('tool-error parts', () => {
    it('yields tool-error steps when the stream contains tool-error parts', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-err',
            toolName: 'shell',
            input: { command: 'invalid' },
          },
          {
            type: 'tool-error',
            toolCallId: 'tc-err',
            error: 'Command not allowed',
          },
          { type: 'finish', finishReason: 'stop' },
        ],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'run a command',
        tools: [
          {
            name: 'shell',
            description: 'Run shell',
            handler: async () => {
              throw new Error('not allowed');
            },
          },
        ],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      const steps: unknown[] = [];
      for await (const step of gen) {
        steps.push(step);
      }
      await gen.next();

      const toolErrorStep = steps.find((s: any) => s.type === 'tool_execution_end');
      expect(toolErrorStep).toBeDefined();
      expect((toolErrorStep as any)?.toolCallId).toBe('tc-err');
    });
  });

  describe('turn perf metrics', () => {
    it('carries the tool name when tool-call arrives after tool-input-end (streamed-input order)', async () => {
      // Real AI SDK streamed-input order: tool-input-end lands BEFORE the
      // final tool-call part. The execution start must still carry the real
      // tool name and the reassembled input.
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'start-step' },
          { type: 'tool-input-start', id: 'tc-1', toolName: 'shell' },
          { type: 'tool-input-delta', id: 'tc-1', delta: '{"command":' },
          { type: 'tool-input-delta', id: 'tc-1', delta: '"ls"}' },
          { type: 'tool-input-end', id: 'tc-1' },
          { type: 'tool-call', toolCallId: 'tc-1', toolName: 'shell', input: { command: 'ls' } },
          { type: 'tool-result', toolCallId: 'tc-1', output: 'files' },
          { type: 'finish-step' },
          { type: 'start-step' },
          { type: 'text-delta', text: 'done' },
          { type: 'finish-step' },
          { type: 'finish', finishReason: 'stop' },
        ],
        steps: [{ toolCalls: [{}] }, { text: 'done' }],
        responseMessages: [{ role: 'assistant', content: 'done' }],
        contentParts: [{ type: 'text', text: 'done' }],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'test',
        tools: [{ name: 'shell', description: 'Run shell', handler: async () => 'files' }],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      const steps: unknown[] = [];
      let next = await gen.next();
      while (!next.done) {
        steps.push(next.value);
        next = await gen.next();
      }
      const agentResult = next.value as { perf?: Record<string, number> };

      const startStep = steps.find((s: any) => s.type === 'tool_execution_start') as any;
      expect(startStep).toBeDefined();
      expect(startStep.toolName).toBe('shell');
      expect(startStep.input).toEqual({ command: 'ls' });
      expect(agentResult?.perf).toMatchObject({ steps: 2, toolCalls: 1 });
    });

    it('emits exactly one execution start when tool-call arrives before tool-input-end', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'start-step' },
          { type: 'tool-call', toolCallId: 'tc-1', toolName: 'read', input: { path: 'a.ts' } },
          { type: 'tool-input-end', id: 'tc-1' },
          { type: 'tool-result', toolCallId: 'tc-1', output: 'contents' },
          { type: 'finish-step' },
          { type: 'finish', finishReason: 'stop' },
        ],
        steps: [{ toolCalls: [{}] }],
        responseMessages: [{ role: 'assistant', content: 'done' }],
        contentParts: [{ type: 'text', text: 'done' }],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'test',
        tools: [{ name: 'read', description: 'Read a file', handler: async () => 'contents' }],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      const steps: unknown[] = [];
      let next = await gen.next();
      while (!next.done) {
        steps.push(next.value);
        next = await gen.next();
      }

      const startSteps = steps.filter((s: any) => s.type === 'tool_execution_start');
      expect(startSteps).toHaveLength(1);
      expect((startSteps[0] as any).toolName).toBe('read');
    });

    it('collects steps, tool calls, and first-token samples from the stream', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'start-step' },
          { type: 'text-delta', text: 'Checking' },
          { type: 'tool-call', toolCallId: 'tc-1', toolName: 'read', input: {} },
          { type: 'tool-input-end', id: 'tc-1' },
          { type: 'tool-result', toolCallId: 'tc-1', output: 'contents' },
          { type: 'finish-step' },
          { type: 'start-step' },
          { type: 'reasoning-delta', text: 'hmm' },
          { type: 'text-delta', text: ' done' },
          { type: 'finish-step' },
          { type: 'finish', finishReason: 'stop' },
        ],
        steps: [{ toolCalls: [{}] }, { text: 'done' }],
        responseMessages: [{ role: 'assistant', content: 'Checking done' }],
        contentParts: [{ type: 'text', text: 'Checking done' }],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'test',
        tools: [
          { name: 'read', description: 'Read a file', handler: async () => 'contents' },
        ],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      // A for-await loop would exhaust the generator and discard the return
      // value, so drive it manually and read the final result.
      let next = await gen.next();
      while (!next.done) {
        next = await gen.next();
      }
      const agentResult = next.value as { perf?: Record<string, number> };

      expect(agentResult?.perf).toBeDefined();
      expect(agentResult.perf).toMatchObject({
        steps: 2,
        toolCalls: 1,
        firstTokenSamples: 2,
      });
      expect(agentResult.perf!.llmMs).toBeGreaterThanOrEqual(0);
      expect(agentResult.perf!.toolMs).toBeGreaterThanOrEqual(0);
      expect(agentResult.perf!.firstTokenMs).toBeGreaterThanOrEqual(0);
    });

    it('reports a text-only turn with no tool timing', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'start-step' },
          { type: 'text-delta', text: 'Hello' },
          { type: 'finish-step' },
          { type: 'finish', finishReason: 'stop' },
        ],
      });
      setupAll(result, { enableTools: true });

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true, enableTools: true },
        prompt: 'test',
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });

      let next = await gen.next();
      while (!next.done) {
        next = await gen.next();
      }
      const agentResult = next.value as { perf?: Record<string, number> };

      expect(agentResult?.perf).toMatchObject({
        steps: 1,
        toolCalls: 0,
        firstTokenSamples: 1,
        toolMs: 0,
      });
    });
  });

  describe('turn usage', () => {
    it('reports the final step input as the context occupancy signal', async () => {
      setupAll(makeStreamTextResult({
        steps: [
          { text: 'first', toolCalls: [], usage: { inputTokens: 500, outputTokens: 10, totalTokens: 510 } },
          { text: 'second', toolCalls: [], usage: { inputTokens: 900, outputTokens: 8, totalTokens: 908 } },
        ],
        usage: { inputTokens: 1400, outputTokens: 18, totalTokens: 1418 },
      }));
      setupAgentConfig();
      setupModel();

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });
      let next = await gen.next();
      while (!next.done) {
        next = await gen.next();
      }
      const agentResult = next.value as { lastStepInputTokens?: number };

      // The turn total is 1400 (every step re-sends the history); occupancy is
      // what the model saw on the final request.
      expect(agentResult.lastStepInputTokens).toBe(900);
    });
  });

  describe('RefusalError and retryability', () => {
    it('isRetryableError returns true for RefusalError', () => {
      const refusal = new RefusalError('Content blocked', 'content-filter');
      expect(isRetryableError(refusal)).toBe(true);
    });

  });

  describe('anthropic cache breakpoints', () => {
    it('marks the last message as an ephemeral cache breakpoint for anthropic runs', async () => {
      let captured: { messages?: Array<Record<string, unknown>> } | undefined;
      streamTextMock.mockImplementation((config: Record<string, unknown>) => {
        captured = config as { messages?: Array<Record<string, unknown>> };
        return makeStreamTextResult();
      });
      setupAgentConfig({ providerType: 'anthropic' });
      setupModel();

      const callerHistory = [{ role: 'user', content: 'prior turn' }];
      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'anthropic',
        providerId: '',
        model: 'claude-3-5-sonnet',
        history: callerHistory,
      });
      for await (const _step of gen) {
        // drain
      }

      const messages = captured?.messages ?? [];
      expect(messages.length).toBe(2);
      const last = messages.at(-1) as { providerOptions?: { anthropic?: { cacheControl?: unknown } } };
      expect(last.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
      // the caller's history array must not be mutated
      expect(callerHistory.length).toBe(1);
      expect((callerHistory[0] as { providerOptions?: unknown }).providerOptions).toBeUndefined();
    });

    it('does not annotate messages for non-anthropic providers', async () => {
      let captured: { messages?: Array<Record<string, unknown>> } | undefined;
      streamTextMock.mockImplementation((config: Record<string, unknown>) => {
        captured = config as { messages?: Array<Record<string, unknown>> };
        return makeStreamTextResult();
      });
      setupAgentConfig();
      setupModel();

      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
      });
      for await (const _step of gen) {
        // drain
      }

      const messages = captured?.messages ?? [];
      const last = messages.at(-1) as { providerOptions?: unknown };
      expect(last.providerOptions).toBeUndefined();
    });
  });

  describe('OpenAI prompt cache routing', () => {
    const runForThread = async (threadId: string, model = 'gpt-4o-mini') => {
      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: 'provider_primary',
        model,
        threadId,
      });
      for await (const _step of gen) {
        // drain
      }
      const call = streamTextMock.mock.calls.at(-1)?.[0] as
        | { providerOptions?: { openai?: { promptCacheKey?: string } } }
        | undefined;
      return call?.providerOptions?.openai?.promptCacheKey;
    };

    it('uses a stable opaque key per thread for provider cache routing', async () => {
      setupAll(makeStreamTextResult());
      setupModel();

      const first = await runForThread('thread_reused');
      const sameThread = await runForThread('thread_reused');
      const otherThread = await runForThread('thread_other');

      expect(first).toMatch(/^iki-thread-[a-f0-9]{32}$/);
      expect(sameThread).toBe(first);
      expect(otherThread).not.toBe(first);
      expect(first).not.toContain('thread_reused');
    });

    it('preserves a configured OpenAI prompt cache key', async () => {
      getModelGenerationSettingsMock.mockReturnValue({
        providerOptions: { openai: { promptCacheKey: 'configured-cache-group' } },
      });
      setupAll(makeStreamTextResult());
      setupModel();

      await runForThread('thread_configured');

      const call = streamTextMock.mock.calls.at(-1)?.[0] as
        | { providerOptions?: { openai?: { promptCacheKey?: string } } }
        | undefined;
      expect(call?.providerOptions?.openai?.promptCacheKey).toBe('configured-cache-group');
    });

    it('does not add a per-thread key to GPT-5.6+ automatic cache routing', async () => {
      setupAll(makeStreamTextResult());
      setupModel();

      await runForThread('thread_auto_routing', 'gpt-5.6');

      const call = streamTextMock.mock.calls.at(-1)?.[0] as
        | { providerOptions?: { openai?: { promptCacheKey?: string } } }
        | undefined;
      expect(call?.providerOptions?.openai?.promptCacheKey).toBeUndefined();
    });
  });

  describe('request prefix stability across prepare steps', () => {
    const drain = async (gen: AsyncGenerator<unknown>) => {
      for await (const _step of gen) {
        // drain
      }
    };

    const getPrepareStep = () => {
      const lastCall = streamTextMock.mock.calls.at(-1);
      if (!lastCall) throw new Error('streamText was not called');
      return (lastCall[0] as {
        prepareStep: (params: { messages: unknown[] }) => Promise<{ messages: Array<Record<string, any>> }>;
      }).prepareStep;
    };

    const markersOf = (messages: Array<Record<string, any>>) =>
      messages.filter(message => message.providerOptions?.anthropic?.cacheControl).length;

    // Sequence prefix: strip the JSON array brackets so a shorter history is a
    // literal string prefix of the grown one (the array terminator would break that).
    const plain = (messages: Array<Record<string, any>>) =>
      JSON.stringify(messages.map(message => ({ role: message.role, content: message.content }))).slice(1, -1);

    it('grows append-only across steps and keeps exactly one rolling breakpoint', async () => {
      setupAll(makeStreamTextResult(), { providerType: 'anthropic' });
      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'anthropic',
        providerId: '',
        model: 'claude-3-5-sonnet',
      });
      await gen.next();

      const prepareStep = getPrepareStep();
      const marked = (content: string) => ({
        role: 'user',
        content,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      });
      // The SDK feeds the previous request's marked messages back in.
      const stepOne = [{ role: 'user', content: 'u1' }, marked('a1')];
      const out1 = await prepareStep({ messages: stepOne });
      const out2 = await prepareStep({ messages: [...stepOne, { role: 'user', content: 'u2' }] });

      // Each request is a content-prefix extension of its predecessor (cache markers excluded).
      expect(
        plain(out2.messages).startsWith(plain(out1.messages)),
        `out1=${plain(out1.messages)} out2=${plain(out2.messages)}`,
      ).toBe(true);

      expect(markersOf(out1.messages)).toBe(1);
      expect(out1.messages.at(-1)?.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
      // The breakpoint moved: the previously marked message must be stripped.
      expect(markersOf(out2.messages)).toBe(1);
      expect(out2.messages.at(-1)?.content).toBe('u2');
      expect(out2.messages[1].providerOptions?.anthropic?.cacheControl).toBeUndefined();

      await drain(gen);
    });

    it('hands the summarizer a marker-free replay of the routed prefix when compaction fires', async () => {
      generateThreadSummaryMock.mockReset().mockResolvedValue({ summary: 'ok' });
      setupAll(makeStreamTextResult(), { providerType: 'anthropic' });
      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'current task',
        tools: [],
        providerType: 'anthropic',
        providerId: '',
        model: 'claude-3-5-sonnet',
        maxInputTokens: 150,
      });
      await gen.next();

      const prepareStep = getPrepareStep();
      const stepOne = [
        { role: 'user', content: 'token '.repeat(150) },
        { role: 'assistant', content: 'ok' },
        {
          role: 'user',
          content: 'current task',
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
      ];
      await prepareStep({ messages: stepOne });

      expect(generateThreadSummaryMock).toHaveBeenCalledTimes(1);
      const call = generateThreadSummaryMock.mock.calls[0][0] as Record<string, any>;
      expect(call.messages[0].content).toContain('token');
      expect(call.cachePrefix).toBeDefined();
      expect(call.cachePrefix.providerType).toBe('anthropic');
      expect(call.cachePrefix.model).toBe('claude-3-5-sonnet');
      // The replay must carry the routed request's system prompt, never the summarizer's own.
      const routedSystem = (streamTextMock.mock.calls.at(-1)?.[0] as { system?: string } | undefined)?.system;
      expect(call.cachePrefix.systemPrompt).toBe(routedSystem);
      expect(call.cachePrefix.systemPrompt).not.toContain('rolling thread summary');
      expect(call.cachePrefix.history).toHaveLength(3);
      for (const message of call.cachePrefix.history) {
        expect(message.providerOptions?.anthropic?.cacheControl).toBeUndefined();
      }

      await drain(gen);
    });

    it('passes the conversation OpenAI cache key to the compaction replay', async () => {
      generateThreadSummaryMock.mockReset().mockResolvedValue({ summary: 'ok' });
      setupAll(makeStreamTextResult(), { providerType: 'openai' });
      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'current task',
        tools: [],
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'gpt-4o-mini',
        threadId: 'thread_replay_key',
        maxInputTokens: 150,
      });
      await gen.next();

      await getPrepareStep()({
        messages: [
          { role: 'user', content: 'token '.repeat(150) },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'current task' },
        ],
      });

      const routedCall = streamTextMock.mock.calls.at(-1)?.[0] as {
        providerOptions?: { openai?: { promptCacheKey?: string } };
      };
      const summaryCall = generateThreadSummaryMock.mock.calls[0][0] as {
        cachePrefix?: { openAIPromptCacheKey?: string };
      };
      expect(summaryCall.cachePrefix?.openAIPromptCacheKey).toBe(
        routedCall.providerOptions?.openai?.promptCacheKey
      );
      expect(summaryCall.cachePrefix?.openAIPromptCacheKey).toMatch(/^iki-thread-[a-f0-9]{32}$/);

      await drain(gen);
    });

    it('does not pass a replay prefix for custom-model runs', async () => {
      generateThreadSummaryMock.mockReset().mockResolvedValue({ summary: 'ok' });
      setupAll(makeStreamTextResult(), { providerType: 'anthropic' });
      const runner = new SimpleAgentRunner({ modelFactory: () => fakeModel });
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'current task',
        tools: [],
        providerType: 'anthropic',
        providerId: '',
        model: 'claude-3-5-sonnet',
        maxInputTokens: 150,
      });
      await gen.next();

      const prepareStep = getPrepareStep();
      await prepareStep({
        messages: [
          { role: 'user', content: 'token '.repeat(150) },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'current task' },
        ],
      });

      expect(generateThreadSummaryMock).toHaveBeenCalledTimes(1);
      expect((generateThreadSummaryMock.mock.calls[0][0] as Record<string, any>).cachePrefix).toBeUndefined();

      await drain(gen);
    });
  });

  describe('external abort signal', () => {
    it('aborts the signal passed to streamText when the caller signal fires', async () => {
      let capturedSignal: AbortSignal | undefined;
      streamTextMock.mockImplementation((config: Record<string, unknown>) => {
        capturedSignal = config.abortSignal as AbortSignal | undefined;
        return makeStreamTextResult();
      });
      setupAgentConfig();
      setupModel();

      const external = new AbortController();
      const runner = new SimpleAgentRunner();
      const gen = runner.run({
        config: { enabled: true },
        prompt: 'test',
        tools: [],
        providerType: 'openai',
        providerId: '',
        model: 'gpt-4o-mini',
        abortSignal: external.signal,
      });

      const consumed = (async () => {
        try {
          for await (const _step of gen) {
            // drain; abort may surface as a thrown AbortError
          }
        } catch {
          // expected when the abort lands mid-stream
        }
      })();

      await vi.waitFor(() => expect(capturedSignal).toBeDefined());
      expect(capturedSignal!.aborted).toBe(false);
      external.abort();
      expect(capturedSignal!.aborted).toBe(true);
      await consumed;
    });
  });
});
