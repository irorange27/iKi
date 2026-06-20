import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('@iki/backend/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('@iki/backend/runtimes/prompt_text_generator', () => ({
  createSimplePromptTextGenerator: vi.fn(),
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
import { generateThreadSummary } from '@iki/backend/agent_session/thread_summary';

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

  it('builds a bounded normalized prompt and strips fenced summary output', async () => {
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

    expect(existingSection.length).toBe(2400);
    expect(existingSection.startsWith('Alpha Beta\n\n')).toBe(true);
    expect(existingSection).not.toContain('\r');
    expect(prompt).toContain('Conversation delta:\nAssistant: answer with space\nUser: final\n\nrequest');
    expect(prompt).not.toContain('older dropped');
  });

  it('clips oversized generated summaries to the maximum stored length', async () => {
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        response: `  ${'x'.repeat(2300)}  `,
      }),
    } as never);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'Summarize this thread.' }],
    });

    expect(result?.summary).toHaveLength(2200);
    expect(result?.summary.endsWith('...')).toBe(true);
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
