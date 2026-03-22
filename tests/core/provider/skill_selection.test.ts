import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('../../../src/core/runtimes/prompt_text_generator', () => ({
  createSimplePromptTextGenerator: vi.fn(),
}));

import { getToolModel } from '../../../src/core/provider/tool_model';
import { createSimplePromptTextGenerator } from '../../../src/core/runtimes/prompt_text_generator';
import { selectSkillsWithAgent } from '../../../src/core/provider/skill_selection';

const getToolModelMock = vi.mocked(getToolModel);
const createSimplePromptTextGeneratorMock = vi.mocked(createSimplePromptTextGenerator);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('selectSkillsWithAgent', () => {
  it('returns empty when tool model is unavailable', async () => {
    getToolModelMock.mockReturnValue(null);

    const skills = await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'Help me choose the best OpenAI model.' }],
      availableSkills: [
        { id: 'codex:.system/openai-docs', name: 'openai-docs', description: 'OpenAI docs' },
      ],
    });

    expect(skills).toEqual([]);
    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
  });

  it('parses JSON array and filters unknown skills (case-insensitive)', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        response: '["codex:.system/openai-docs","NOPE","codex:.SYSTEM/openai-docs"]',
      }),
    });

    const skills = await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'How do I build with OpenAI APIs?' }],
      availableSkills: [
        { id: 'codex:.system/openai-docs', name: 'openai-docs', description: 'OpenAI docs' },
        { id: 'user:my-skill', name: 'my-skill', description: 'Custom' },
      ],
    });

    expect(skills).toEqual(['codex:.system/openai-docs']);
  });

  it('supports object output with skills field', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: '{ "skills": ["user:my-skill"] }' }),
    });

    const skills = await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'Use my custom workflow.' }],
      availableSkills: [{ id: 'user:my-skill', name: 'my-skill', description: 'Custom' }],
    });

    expect(skills).toEqual(['user:my-skill']);
  });

  it('handles fenced JSON output', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({ response: '```json\n["user:my-skill"]\n```' }),
    });

    const skills = await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'Please follow my style guide.' }],
      availableSkills: [{ id: 'user:my-skill', name: 'my-skill', description: 'Custom' }],
    });

    expect(skills).toEqual(['user:my-skill']);
  });

  it('injects affect as a first-class routing signal', async () => {
    const generate = vi.fn().mockResolvedValue({ response: '["user:my-skill"]' });
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    createSimplePromptTextGeneratorMock.mockReturnValue({ generate });

    await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'Help me respond carefully.' }],
      availableSkills: [{ id: 'user:my-skill', name: 'my-skill', description: 'Custom' }],
      affectState: {
        label: 'sadness',
        confidence: 0.71,
        valence: -0.52,
        arousal: 0.42,
        emotions: [{ label: 'sadness', score: 0.71 }],
        sampleCount: 4,
        windowSize: 8,
        startAt: '2026-03-22T00:00:00.000Z',
        endAt: '2026-03-22T00:05:00.000Z',
        ageMinutes: 2,
        windowMinutes: 5,
      },
    });

    expect(generate).toHaveBeenCalledWith(expect.stringContaining('Current user affect signal:'));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('primary=sadness'));
  });
});
