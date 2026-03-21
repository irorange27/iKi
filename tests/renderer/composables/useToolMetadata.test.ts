import { describe, expect, it, vi } from 'vitest';

import { useToolMetadata } from '../../../src/renderer/composables/useToolMetadata';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useToolMetadata', () => {
  it('loads tool sources and resolves MCP server labels from the shared metadata list', async () => {
    const list = vi.fn(async () => [
      {
        name: 'mcp_docs_search',
        source: {
          kind: 'mcp',
          id: 'docs_server',
          name: 'Docs Server',
        },
      },
      {
        name: 'web',
        source: {
          kind: 'builtin',
          name: 'Web',
        },
      },
      {
        name: '',
        source: {
          kind: 'mcp',
          id: 'ignored',
        },
      },
    ]);

    const state = useToolMetadata({
      electronAPI: {
        tools: { list },
        skills: {},
      } as never,
    });

    await state.loadToolSources();

    expect(list).toHaveBeenCalledTimes(1);
    expect(
      state.getMcpServerLabel({
        type: 'dynamic-tool',
        toolName: 'mcp_docs_search',
      })
    ).toBe('Docs Server');
    expect(
      state.getMcpServerLabel({
        type: 'dynamic-tool',
        toolName: 'web',
      })
    ).toBe('');
  });

  it('lazy-loads tool metadata when an MCP tool label is requested before sources are loaded', async () => {
    const list = vi.fn(async () => [
      {
        name: 'mcp_docs_search',
        source: {
          kind: 'mcp',
          id: 'docs_server',
          name: 'Docs Server',
        },
      },
    ]);

    const state = useToolMetadata({
      electronAPI: {
        tools: { list },
        skills: {},
      } as never,
    });

    expect(
      state.getMcpServerLabel({
        type: 'dynamic-tool',
        toolName: 'mcp_docs_search',
      })
    ).toBe('');

    await flushMicrotasks();

    expect(list).toHaveBeenCalledTimes(1);
    expect(
      state.getMcpServerLabel({
        type: 'dynamic-tool',
        toolName: 'mcp_docs_search',
      })
    ).toBe('Docs Server');
  });

  it('warns when opening a skill reference fails or the bridge throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const openSkill = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Missing skill' })
      .mockRejectedValueOnce(new Error('IPC unavailable'));

    const state = useToolMetadata({
      electronAPI: {
        tools: { list: vi.fn(async () => []) },
        skills: { openSkill },
      } as never,
    });

    await state.openSkillReference('skill_missing');
    await state.openSkillReference('skill_error');

    expect(openSkill).toHaveBeenNthCalledWith(1, 'skill_missing');
    expect(openSkill).toHaveBeenNthCalledWith(2, 'skill_error');
    expect(warn).toHaveBeenNthCalledWith(1, 'Failed to open skill:', 'Missing skill');
    expect(warn).toHaveBeenNthCalledWith(2, 'Failed to open skill:', expect.any(Error));
  });
});
