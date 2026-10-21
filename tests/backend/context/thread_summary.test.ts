import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerEventMock, generateMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock('@iki/backend/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  generateChatWithModelMessages: generateMock,
  getModelGenerationSettings: vi.fn(() => ({})),
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
import { generateThreadSummary } from '@iki/backend/runtimes/thread_summary';
import {
  COMPACTION_INSTRUCTION,
  SUMMARY_OPEN_TAG,
} from '@iki/backend/runtimes/compaction_prompt';

const getToolModelMock = vi.mocked(getToolModel);

const toolModel = {
  providerType: 'openai' as const,
  model: 'gpt-4o-mini',
};

const lastRequest = () => generateMock.mock.calls.at(-1)?.[0] as {
  messages: Array<{ role: string; content: unknown }>;
  maxOutputTokens?: number;
};

beforeEach(() => {
  vi.clearAllMocks();
  getToolModelMock.mockReturnValue(toolModel);
  generateMock.mockResolvedValue({ text: '## Primary Request and Intent\n- do the thing' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateThreadSummary', () => {
  it('returns null when there is neither history nor messages', async () => {
    const result = await generateThreadSummary({ messages: [] });

    expect(result).toBeNull();
    expect(getToolModelMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('returns null and warns when no tool model is available', async () => {
    getToolModelMock.mockReturnValue(null);

    const result = await generateThreadSummary({
      messages: [{ role: 'user', content: 'Summarize this thread.' }],
    });

    expect(result).toBeNull();
    expect(generateMock).not.toHaveBeenCalled();
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'thread.summary.generate',
        outcome: 'skipped',
      })
    );
  });

  it('replays the supplied history and appends the compaction instruction as the last user message', async () => {
    const history = [
      { role: 'system' as const, content: 'persona prompt' },
      { role: 'user' as const, content: 'first request' },
      { role: 'assistant' as const, content: 'first answer' },
    ];

    const result = await generateThreadSummary({
      history,
      messages: [{ role: 'user', content: 'older dropped' }],
    });

    expect(result).toEqual({
      summary: '## Primary Request and Intent\n- do the thing',
      model: toolModel,
    });

    const request = lastRequest();
    expect(request.messages.slice(0, 3)).toEqual(history);
    const tail = request.messages.at(-1)!;
    expect(tail.role).toBe('user');
    expect(JSON.stringify(tail.content)).toContain('You are now acting as a compaction engine');
    expect(request.maxOutputTokens).toBeGreaterThan(320);
  });

  it('asks for every structured checkpoint section', async () => {
    await generateThreadSummary({
      history: [{ role: 'user', content: 'work on the repo' }],
    });

    const instruction = JSON.stringify(lastRequest().messages.at(-1)!.content);
    for (const section of [
      '## Primary Request and Intent',
      '## Key Technical Concepts',
      '## Files and Code',
      '## Errors and Fixes',
      '## Pending Jobs',
      '## Current Work',
      '## Next Step',
      '## Critical Context',
    ]) {
      expect(instruction).toContain(section);
    }
    expect(instruction).toContain(SUMMARY_OPEN_TAG);
    expect(COMPACTION_INSTRUCTION).toContain('never drop a section');
  });

  it('falls back to the transcript prompt when no history is supplied', async () => {
    const result = await generateThreadSummary({
      existingSummary: 'prior facts',
      messages: [
        { role: 'user', content: 'older request' },
        { role: 'assistant', content: 'older answer' },
      ],
    });

    expect(result).not.toBeNull();
    const body = JSON.stringify(lastRequest().messages);
    expect(body).toContain('prior facts');
    expect(body).toContain('older request');
    expect(body).toContain('You are now acting as a compaction engine');
  });

  it('strips fenced output and surrounding quotes', async () => {
    generateMock.mockResolvedValue({
      text: '```markdown\n"## Primary Request and Intent\n- ship it"\n```',
    });

    const result = await generateThreadSummary({
      history: [{ role: 'user', content: 'go' }],
    });

    expect(result?.summary).toBe('## Primary Request and Intent\n- ship it');
  });

  it('preserves a long summary instead of truncating it', async () => {
    generateMock.mockResolvedValue({ text: `  ${'x'.repeat(2300)}  ` });

    const result = await generateThreadSummary({
      history: [{ role: 'user', content: 'go' }],
    });

    expect(result?.summary).toHaveLength(2300);
    expect(result?.summary.endsWith('...')).toBe(false);
  });

  it('returns null when the generated summary sanitizes to empty text', async () => {
    generateMock.mockResolvedValue({ text: '```text\n   \n```' });

    const result = await generateThreadSummary({
      history: [{ role: 'user', content: 'go' }],
    });

    expect(result).toBeNull();
  });

  it('returns null and warns when the call throws', async () => {
    const error = new Error('generator failed');
    generateMock.mockRejectedValue(error);

    const result = await generateThreadSummary({
      history: [{ role: 'user', content: 'go' }],
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

  it('rethrows when the caller aborted instead of swallowing it', async () => {
    const controller = new AbortController();
    controller.abort();
    generateMock.mockRejectedValue(new Error('aborted'));

    await expect(
      generateThreadSummary({
        history: [{ role: 'user', content: 'go' }],
        abortSignal: controller.signal,
      })
    ).rejects.toThrow('aborted');
  });
});
