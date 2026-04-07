import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('../../../src/core/runtimes/prompt_text_generator', () => ({
  createSimplePromptTextGenerator: vi.fn(),
}));

import { getToolModel } from '../../../src/core/provider/tool_model';
import { createSimplePromptTextGenerator } from '../../../src/core/runtimes/prompt_text_generator';
import { selectToolsWithAgent } from '../../../src/core/provider/tool_selection';

const getToolModelMock = vi.mocked(getToolModel);
const createSimplePromptTextGeneratorMock = vi.mocked(createSimplePromptTextGenerator);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('selectToolsWithAgent', () => {
  it('returns null when tool model is unavailable', async () => {
    getToolModelMock.mockReturnValue(null);

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Search the web for this.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toBeNull();
    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
  });

  it('parses JSON array and filters unknown tools (case-insensitive)', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: '["web","NOPE","FETCH"]' }),
    });

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Fetch this URL.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toEqual(['web', 'fetch']);
  });

  it('supports object output with tools field', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: '{ "tools": ["fetch"] }' }),
    });

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Get this page.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toEqual(['fetch']);
  });

  it('handles fenced JSON output', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: '```json\n["web"]\n```' }),
    });

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Search.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toEqual(['web']);
  });

  it('injects affect as a first-class routing signal', async () => {
    const generate = vi.fn().mockResolvedValue({ response: '["web"]' });
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({ generate });

    await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Should I act now?' }],
      availableTools: [{ name: 'web' }],
      affectState: {
        label: 'anger',
        confidence: 0.82,
        valence: -0.64,
        arousal: 0.77,
        emotions: [{ label: 'anger', score: 0.82 }],
        sampleCount: 3,
        windowSize: 8,
        startAt: '2026-03-22T00:00:00.000Z',
        endAt: '2026-03-22T00:05:00.000Z',
        ageMinutes: 1,
        windowMinutes: 5,
      },
    });

    expect(generate).toHaveBeenCalledWith(expect.stringContaining('Current user affect signal:'));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('first-class user-state signal'));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('primary=anger'));
  });

  it('tells the router to verify live local state with tools instead of guessing', async () => {
    const generate = vi.fn().mockResolvedValue({ response: '["shell"]' });
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({ generate });

    await selectToolsWithAgent({
      messages: [{ role: 'user', content: '现在几点了？' }],
      availableTools: [{ name: 'shell' }],
    });

    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'include the tool needed to verify it instead of guessing'
        ),
      })
    );
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('current local machine state'),
      })
    );
  });

  it('tells the router to pair web search with fetch when page facts are needed', async () => {
    const generate = vi.fn().mockResolvedValue({ response: '["web","fetch"]' });
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({ generate });

    await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'What is the latest London spot gold price?' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          '`web` only discovers candidate pages. If the answer depends on facts inside those pages'
        ),
      })
    );
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('include `fetch` too instead of relying on search-result snippets alone'),
      })
    );
  });

  it('tells the router to include todo for multi-step work', async () => {
    const generate = vi.fn().mockResolvedValue({ response: '["todo","shell"]' });
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({ generate });

    await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Inspect the repo, implement the fix, and run checks.' }],
      availableTools: [{ name: 'todo' }, { name: 'shell' }],
    });

    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'Include `todo` only when the task is genuinely substantial and multi-step'
        ),
      })
    );
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'Do NOT include `todo` for simple questions, one-shot lookups, single command checks'
        ),
      })
    );
  });

  it('tells the router to use agent only for bounded delegated subtasks', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: '["agent"]' }),
    });

    await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Review the architecture and then decide what to do.' }],
      availableTools: [{ name: 'agent' }, { name: 'shell' }],
    });

    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'Include `agent` only when the turn naturally splits into coordinator + worker'
        ),
      })
    );
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'Good `agent` cases: compare several fetched/web sources and report differences'
        ),
      })
    );
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'If the likely subtask depends on tools such as `shell`, `read_file`, `write_file`, `edit`, or `delete_file`, do not include `agent` for that step'
        ),
      })
    );
    expect(createSimplePromptTextGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'If the available approval-free tools would not materially help the delegated subtask, omit `agent`'
        ),
      })
    );
  });
});
