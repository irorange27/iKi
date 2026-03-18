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
  it('returns empty when tool model is unavailable', async () => {
    getToolModelMock.mockReturnValue(null);

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Search the web for today news.' }],
      availableTools: [
        { name: 'web', description: 'Search the web' },
        { name: 'fetch', description: 'Fetch a URL' },
      ],
    });

    expect(tools).toEqual([]);
    expect(SimpleAgentMock).not.toHaveBeenCalled();
  });

  it('parses JSON array and filters unknown tools (case-insensitive)', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi
            .fn()
            .mockResolvedValue({ response: '["web","NOPE","FETCH","web"]' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Please look up the latest info and open the URL.' }],
      availableTools: [
        { name: 'web', description: 'Search the web' },
        { name: 'fetch', description: 'Fetch a URL' },
      ],
    });

    expect(tools).toEqual(['web', 'fetch']);
  });

  it('supports object output with tools field', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '{ "tools": ["read_file"] }' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Read the config file.' }],
      availableTools: [
        { name: 'read_file', description: 'Read a file' },
        { name: 'list_dir', description: 'List a directory' },
      ],
    });

    expect(tools).toEqual(['read_file']);
  });

  it('handles fenced JSON output', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '```json\n["shell"]\n```' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const tools = await selectToolsWithAgent({
      messages: [{ role: 'user', content: 'Run `npm test`.' }],
      availableTools: [{ name: 'shell', description: 'Run shell commands' }],
    });

    expect(tools).toEqual(['shell']);
  });
});

