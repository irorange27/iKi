import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerEventMock, generateTextMock, createModelMock, disposeLanguageModelMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
  generateTextMock: vi.fn(),
  createModelMock: vi.fn(),
  disposeLanguageModelMock: vi.fn(),
}));

vi.mock('@iki/backend/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('@iki/backend/runtimes/prompt_text_generator', () => ({
  createSimplePromptTextGenerator: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('@iki/backend/provider/llm/factory', () => ({
  createModel: createModelMock,
  disposeLanguageModel: disposeLanguageModelMock,
}));

vi.mock('@iki/backend/observability/langfuse', () => ({
  langfuseTelemetry: vi.fn(() => undefined),
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import { getToolModel } from '@iki/backend/provider/tool_model';
import { createSimplePromptTextGenerator } from '@iki/backend/runtimes/prompt_text_generator';
import {
  generateThreadSummary,
  type ThreadSummaryCachePrefix,
} from '@iki/backend/runtimes/thread_summary';

const getToolModelMock = vi.mocked(getToolModel);
const createSimplePromptTextGeneratorMock = vi.mocked(createSimplePromptTextGenerator);

const toolModel = {
  providerType: 'openai' as const,
  model: 'gpt-4o-mini',
};

beforeEach(() => {
  vi.clearAllMocks();
  getToolModelMock.mockReturnValue(toolModel);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateThreadSummary', () => {
  it('returns null when there are no messages', async () => {
    const result = await generateThreadSummary({ messages: [] });

    expect(result).toBeNull();
    expect(getToolModelMock).not.toHaveBeenCalled();
    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
  });

  it('returns null and warns when no tool model is available', async () => {
    getToolModelMock.mockReturnValue(null);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'Summarize this thread.' }],
    });

    expect(result).toBeNull();
    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'thread.summary.generate',
        outcome: 'skipped',
      })
    );
  });

  it('summarizes the complete prefix and strips fenced summary output', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      response: '```text\n"Summary line 1\n\n\nline 2"\n```',
    });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: generateMock,
    } as never);

    const existingSummary = `  Alpha\tBeta\r\n\r\n\r\n${'x'.repeat(2500)}  `;
    const result = await generateThreadSummary({
      existingSummary,
      messages: [
        { role: 'user', content: `older dropped ${'x'.repeat(13000)}` },
        { role: 'assistant', content: '  answer\twith  space  ' },
        { role: 'assistant', content: '   ' },
        { role: 'user', content: 'final\n\n\nrequest' },
      ],
    });

    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: expect.stringContaining('You maintain a rolling thread summary'),
      temperature: 0.1,
      maxTokens: 320,
      maxIterations: 1,
      enableTools: false,
      enableMemory: false,
    });
    expect(result).toEqual({
      summary: 'Summary line 1\n\nline 2',
      model: toolModel,
    });

    const prompt = String(generateMock.mock.calls[0]?.[0] ?? '');
    const existingSection = prompt
      .split('Existing summary:\n')[1]
      .split('\n\nConversation delta:')[0];

    expect(existingSection).toBe(existingSummary);
    expect(prompt).toContain('older dropped');
    expect(prompt).toContain('x'.repeat(13000));

  });

  it('preserves the complete generated summary', async () => {
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        response: `  ${'x'.repeat(2300)}  `,
      }),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'Summarize this thread.' }],
    });

    expect(result?.summary).toHaveLength(2300);
    expect(result?.summary.endsWith('...')).toBe(false);
    expect(result?.model).toEqual(toolModel);
  });

  it('returns null when the generated summary sanitizes to empty text', async () => {
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        response: '```text\n   \n```',
      }),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'Summarize this thread.' }],
    });

    expect(result).toBeNull();
  });

  it('returns null and warns when summary generation throws', async () => {
    const error = new Error('generator failed');
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockRejectedValue(error),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'Summarize this thread.' }],
    });

    expect(result).toBeNull();
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'thread.summary.generate',
        outcome: 'failed',
        error,
      })
    );
  });
});

describe('generateThreadSummary — cache-aware prefix replay', () => {
  const conversationModel = {
    providerType: 'anthropic',
    providerId: 'p1',
    model: 'claude-3-5-sonnet',
  };

  const cachePrefix: ThreadSummaryCachePrefix = {
    ...conversationModel,
    systemPrompt: 'routed system prompt',
    history: [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
    ],
    tools: {
      probe: { description: 'probe', inputSchema: {}, execute: async () => 'ran' },
    } as unknown as ThreadSummaryCachePrefix['tools'],
  };

  it('replays the routed prefix with the summary instruction as the final user message when routes match', async () => {
    getToolModelMock.mockReturnValue({ ...conversationModel });
    generateTextMock.mockResolvedValue({ text: 'plain summary' });
    createModelMock.mockReturnValue({ fake: 'model' });

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'dropped middle' }],
      cachePrefix,
    });

    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
    expect(createModelMock).toHaveBeenCalledWith('anthropic', 'claude-3-5-sonnet', 'p1');
    const call = generateTextMock.mock.calls[0][0] as Record<string, any>;
    expect(call.system).toBe('routed system prompt');
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0]).toEqual({ role: 'user', content: 'old question' });
    // The replay re-marks the prefix tail so the aux read matches the routed request's cached prefix.
    expect(call.messages[1].providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    expect(call.messages[2].role).toBe('user');
    expect(call.messages[2].content).toContain('Conversation delta:');
    expect(call.messages[2].content).toContain('dropped middle');
    // Schemas stay byte-identical to the routed request; execute handlers must not ride along.
    expect(call.tools.probe).toEqual({ description: 'probe', inputSchema: {} });
    expect(call.temperature).toBe(0.1);
    expect(call.maxOutputTokens).toBe(320);
    expect(result).toEqual({ summary: 'plain summary', model: { ...conversationModel } });
    expect(disposeLanguageModelMock).toHaveBeenCalledWith({ fake: 'model' });
  });

  it('replays without anthropic markers when the route is not breakpoint-driven', async () => {
    const openaiModel = { ...conversationModel, providerType: 'openai', model: 'gpt-4o-mini' };
    getToolModelMock.mockReturnValue({ ...openaiModel });
    generateTextMock.mockResolvedValue({ text: 'plain summary' });
    createModelMock.mockReturnValue({ fake: 'model' });

    await generateThreadSummary({
      messages: [{ role: 'user', content: 'dropped middle' }],
      cachePrefix: { ...cachePrefix, ...openaiModel },
    });

    const call = generateTextMock.mock.calls[0][0] as Record<string, any>;
    for (const message of call.messages) {
      expect(message.providerOptions?.anthropic?.cacheControl).toBeUndefined();
    }
  });

  it('keeps the standalone tool-model call when the cache prefix routes elsewhere', async () => {
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: 'standalone summary' }),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'dropped middle' }],
      cachePrefix,
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalled();
    expect(result?.summary).toBe('standalone summary');
  });

  it('falls back to the standalone call when the replayed prefix produces no text', async () => {
    getToolModelMock.mockReturnValue({ ...conversationModel });
    generateTextMock.mockResolvedValue({ text: '```text\n   \n```' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: 'fallback summary' }),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'dropped middle' }],
      cachePrefix,
    });

    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalled();
    expect(result).toEqual({ summary: 'fallback summary', model: { ...conversationModel } });
  });

  it('falls back to the standalone call when the replayed prefix request fails', async () => {
    getToolModelMock.mockReturnValue({ ...conversationModel });
    generateTextMock.mockRejectedValue(new Error('aux request down'));
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: 'fallback summary' }),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'dropped middle' }],
      cachePrefix,
    });

    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'thread.summary.cache_prefix',
        outcome: 'failed',
      })
    );
    expect(result?.summary).toBe('fallback summary');
  });

  it('rethrows aborts from the replayed prefix request', async () => {
    getToolModelMock.mockReturnValue({ ...conversationModel });
    const abortError = new DOMException('cancelled', 'AbortError');
    generateTextMock.mockRejectedValue(abortError);
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateThreadSummary({
        messages: [{ role: 'user', content: 'dropped middle' }],
        cachePrefix,
        abortSignal: controller.signal,
      })
    ).rejects.toBe(abortError);
    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
  });
});
