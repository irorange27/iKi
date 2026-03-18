import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('../../../src/core/agent', () => ({
  SimpleAgent: vi.fn(),
}));

import { getToolModel } from '../../../src/core/provider/tool_model';
import { SimpleAgent } from '../../../src/core/agent';
import { selectToolsWithAgent } from '../../../src/core/provider/tool_selection';

const getToolModelMock = vi.mocked(getToolModel);
const SimpleAgentMock = vi.mocked(SimpleAgent);

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
    expect(SimpleAgentMock).not.toHaveBeenCalled();
  });

  it('parses JSON array and filters unknown tools (case-insensitive)', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '["web","NOPE","FETCH"]' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Fetch this URL.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toEqual(['web', 'fetch']);
  });

  it('supports object output with tools field', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '{ "tools": ["fetch"] }' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Get this page.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toEqual(['fetch']);
  });

  it('handles fenced JSON output', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '```json\n["web"]\n```' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Search.' }],
      availableTools: [{ name: 'web' }, { name: 'fetch' }],
    });

    expect(tools).toEqual(['web']);
  });
});
