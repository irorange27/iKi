import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Realistic AI SDK stream mocks ──────────────────────────────────────────
// These mocks simulate the AI SDK's actual two-layer stream architecture
// (inner step stream → outer fullStream + 5 independent deferred promises),
// which the existing test suite's trivial vi.fn() mocks do not capture.

const {
  streamTextMock,
  smoothStreamMock,
  stepCountIsMock,
} = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  smoothStreamMock: vi.fn(),
  stepCountIsMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: streamTextMock,
  smoothStream: smoothStreamMock,
  stepCountIs: stepCountIsMock,
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
  });

  describe('error part in fullStream (Bug 1: NoOutputGeneratedError)', () => {
    it('logs error parts and continues processing subsequent parts', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          { type: 'text-delta', text: 'Before error.' },
          {
            type: 'error',
            error: new Error('AI_NoOutputGeneratedError: No output generated.'),
          },
          { type: 'text-delta', text: 'After error.' },
          { type: 'finish', finishReason: 'stop' },
        ],
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
      let result_: unknown;
      for await (const step of gen) {
        steps.push(step);
      }
      // Get the return value
      const iterResult = await gen.next();
      result_ = iterResult.value;

      // Should have received both text deltas
      const textSteps = steps.filter((s: any) => s.type === 'message_update');
      expect(textSteps).toHaveLength(2);

      // Should have completed successfully despite the error part
      const finishStep = steps.find((s: any) => s.type === 'turn_end');
      expect(finishStep).toBeDefined();
      expect((finishStep as any)?.text).toContain('After error');
    });

    it('handles error parts with non-Error payloads gracefully', async () => {
      const result = makeStreamTextResult({
        fullStreamParts: [
          {
            type: 'error',
            error: 'plain string error message',
          },
          { type: 'finish', finishReason: 'stop' },
        ],
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

      const finishStep = steps.find((s: any) => s.type === 'turn_end');
      expect(finishStep).toBeDefined();
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

  describe('RefusalError and retryability', () => {
    it('isRetryableError returns true for RefusalError', () => {
      const refusal = new RefusalError('Content blocked', 'content-filter');
      expect(isRetryableError(refusal)).toBe(true);
    });

    it('isRetryableError returns false for AbortError', () => {
      const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
      expect(isRetryableError(abort)).toBe(false);
    });

    it('isRetryableError returns true for transient system errors (ECONNRESET)', () => {
      const econnreset = Object.assign(new Error('connection reset'), {
        code: 'ECONNRESET',
      });
      expect(isRetryableError(econnreset)).toBe(true);
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
