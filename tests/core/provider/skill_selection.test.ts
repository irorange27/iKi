import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('../../../src/core/agent', () => ({
  SimpleAgent: vi.fn(),
}));

import { getToolModel } from '../../../src/core/provider/tool_model';
import { SimpleAgent } from '../../../src/core/agent';
import { selectSkillsWithAgent } from '../../../src/core/provider/skill_selection';

const getToolModelMock = vi.mocked(getToolModel);
const SimpleAgentMock = vi.mocked(SimpleAgent);

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
    expect(SimpleAgentMock).not.toHaveBeenCalled();
  });

  it('parses JSON array and filters unknown skills (case-insensitive)', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi
            .fn()
            .mockResolvedValue({ response: '["codex:.system/openai-docs","NOPE","codex:.SYSTEM/openai-docs"]' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

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
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '{ "skills": ["user:my-skill"] }' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const skills = await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'Use my custom workflow.' }],
      availableSkills: [{ id: 'user:my-skill', name: 'my-skill', description: 'Custom' }],
    });

    expect(skills).toEqual(['user:my-skill']);
  });

  it('handles fenced JSON output', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '```json\n["user:my-skill"]\n```' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const skills = await selectSkillsWithAgent({
      messages: [{ role: 'user', content: 'Please follow my style guide.' }],
      availableSkills: [{ id: 'user:my-skill', name: 'my-skill', description: 'Custom' }],
    });

    expect(skills).toEqual(['user:my-skill']);
  });
});

