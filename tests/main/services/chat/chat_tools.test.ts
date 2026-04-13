import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTool, defaultToolRegistry } from '../../../../src/core/tools';
import { getAppConfig } from '../../../../src/core/config';
import { selectToolsWithAgent } from '../../../../src/core/provider/tool_selection';
import { resolveToolNames } from '../../../../src/main/services/chat/chat_tools';

vi.mock('../../../../src/core/config', () => ({
  getAppConfig: vi.fn(() => ({
    general: {
      autoApproveToolRequests: false,
    },
  })),
}));

vi.mock('../../../../src/core/provider/tool_selection', () => ({
  selectToolsWithAgent: vi.fn(async () => null),
}));

const TEST_TOOL_NAMES = [
  'web',
  'fetch',
  'shell',
  'list_dir',
  'read_file',
  'edit',
  'write_file',
  'delete_file',
  'mcp_alpha_safe',
  'mcp_beta_unsafe',
  'manual_only',
  'agent',
  'todo',
  'list_todo_lists',
  'read_todo_list',
  'write_todo_list',
  'delete_todo_list',
  'list_proactive_tasks',
  'read_proactive_task',
  'write_proactive_task',
  'delete_proactive_task',
  'write_personal_skill',
];

const registerTool = (options: {
  name: string;
  autoAllowed?: boolean;
  needsApproval?: boolean;
  approvalMode?: 'configurable' | 'always';
  source?: { kind: 'builtin' | 'mcp'; id?: string; name?: string };
}) => {
  defaultToolRegistry.register(
    createTool({
      name: options.name,
      type: 'function',
      description: `Tool ${options.name}`,
      parameters: { type: 'object', properties: {} },
      autoAllowed: options.autoAllowed,
      needsApproval: options.needsApproval,
      approvalMode: options.approvalMode,
      source: options.source,
      handler: async () => ({ ok: true }),
    })
  );
};

const getAppConfigMock = vi.mocked(getAppConfig);
const selectToolsWithAgentMock = vi.mocked(selectToolsWithAgent);

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue({
    general: {
      autoApproveToolRequests: false,
    },
  } as never);
  selectToolsWithAgentMock.mockResolvedValue(null);
});

afterEach(() => {
  for (const toolName of TEST_TOOL_NAMES) {
    defaultToolRegistry.remove(toolName);
  }
});

describe('resolveToolNames', () => {
  it('filters manual MCP tools to the selected servers', async () => {
    registerTool({ name: 'web', source: { kind: 'builtin' } });
    registerTool({
      name: 'mcp_alpha_safe',
      autoAllowed: true,
      source: { kind: 'mcp', id: 'alpha', name: 'Alpha' },
    });
    registerTool({
      name: 'mcp_beta_unsafe',
      source: { kind: 'mcp', id: 'beta', name: 'Beta' },
    });

    const result = await resolveToolNames({
      tools: ['web', 'mcp_alpha_safe', 'mcp_beta_unsafe'],
      mcpServerIds: ['alpha'],
    });

    expect(result.mode).toBe('manual');
    expect(result.explicitTools).toEqual(['web', 'mcp_alpha_safe', 'mcp_beta_unsafe']);
    expect(result.resolvedTools).toEqual(['web', 'mcp_alpha_safe']);
  });

  it('keeps backward compatibility for manual MCP selections when no server list is provided', async () => {
    registerTool({
      name: 'manual_only',
      source: { kind: 'mcp', id: 'legacy', name: 'Legacy' },
    });

    const result = await resolveToolNames({
      tools: ['manual_only'],
    });

    expect(result.mode).toBe('manual');
    expect(result.resolvedTools).toEqual(['manual_only']);
  });

  it('includes enabled MCP tools in auto mode unless they explicitly opt out', async () => {
    registerTool({ name: 'web', autoAllowed: true, source: { kind: 'builtin' } });
    registerTool({ name: 'fetch', autoAllowed: true, source: { kind: 'builtin' } });
    registerTool({
      name: 'mcp_alpha_safe',
      autoAllowed: true,
      source: { kind: 'mcp', id: 'alpha', name: 'Alpha' },
    });
    registerTool({
      name: 'mcp_beta_unsafe',
      autoAllowed: false,
      source: { kind: 'mcp', id: 'beta', name: 'Beta' },
    });

    const result = await resolveToolNames({
      mcpServerIds: ['alpha', 'beta'],
      inputMessages: [],
    });

    expect(result.mode).toBe('auto');
    expect(result.explicitTools).toEqual([]);
    expect(result.resolvedTools).toEqual(['web', 'fetch', 'mcp_alpha_safe']);
  });

  it('defaults built-in tools to auto mode unless they explicitly opt out', async () => {
    registerTool({ name: 'shell', source: { kind: 'builtin' } });
    registerTool({ name: 'list_dir', source: { kind: 'builtin' } });
    registerTool({ name: 'read_file', source: { kind: 'builtin' } });
    registerTool({ name: 'edit', source: { kind: 'builtin' } });
    registerTool({ name: 'write_file', source: { kind: 'builtin' } });
    registerTool({ name: 'delete_file', source: { kind: 'builtin' } });
    registerTool({ name: 'manual_only', autoAllowed: false, source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual([
      'shell',
      'list_dir',
      'read_file',
      'edit',
      'write_file',
      'delete_file',
    ]);
  });

  it('includes todo planning and todo-list tools in auto mode for normal chat turns', async () => {
    registerTool({ name: 'todo', source: { kind: 'builtin' } });
    registerTool({ name: 'list_todo_lists', source: { kind: 'builtin' } });
    registerTool({ name: 'read_todo_list', source: { kind: 'builtin' } });
    registerTool({ name: 'write_todo_list', source: { kind: 'builtin' } });
    registerTool({ name: 'delete_todo_list', source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual([
      'todo',
      'list_todo_lists',
      'read_todo_list',
      'write_todo_list',
      'delete_todo_list',
    ]);
  });

  it('includes proactive task management tools in auto mode for task-management turns', async () => {
    registerTool({ name: 'list_proactive_tasks', source: { kind: 'builtin' } });
    registerTool({ name: 'read_proactive_task', source: { kind: 'builtin' } });
    registerTool({ name: 'write_proactive_task', source: { kind: 'builtin' } });
    registerTool({ name: 'delete_proactive_task', source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual([
      'list_proactive_tasks',
      'read_proactive_task',
      'write_proactive_task',
      'delete_proactive_task',
    ]);
  });

  it('includes the delegated agent tool in auto mode when it is registered', async () => {
    registerTool({ name: 'agent', source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual([]);
  });

  it('drops todo from overeager auto selections for simple requests', async () => {
    selectToolsWithAgentMock.mockResolvedValue(['todo', 'shell']);
    registerTool({ name: 'todo', source: { kind: 'builtin' } });
    registerTool({ name: 'shell', source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [{ role: 'user', content: 'What time is it right now?' }],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual(['shell']);
  });

  it('keeps todo for clearly substantial multi-step work even with a small tool set', async () => {
    selectToolsWithAgentMock.mockResolvedValue(['todo', 'shell']);
    registerTool({ name: 'todo', source: { kind: 'builtin' } });
    registerTool({ name: 'shell', source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [
        {
          role: 'user',
          content: 'Inspect the repo, implement the fix, and run checks before you finish.',
        },
      ],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual(['todo', 'shell']);
  });

  it('keeps agent for delegated source-comparison work when an approval-free sibling tool is selected', async () => {
    selectToolsWithAgentMock.mockResolvedValue(['agent', 'web', 'fetch']);
    registerTool({ name: 'agent', source: { kind: 'builtin' } });
    registerTool({ name: 'web', needsApproval: false, source: { kind: 'builtin' } });
    registerTool({ name: 'fetch', needsApproval: false, source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [
        {
          role: 'user',
          content: '搜索几篇资料，比较它们对 agent delegation 的实现差异，然后再告诉我关键取舍。',
        },
      ],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual(['agent', 'web', 'fetch']);
  });

  it('drops agent when auto selection leaves it without a usable delegated sibling tool', async () => {
    selectToolsWithAgentMock.mockResolvedValue(['agent', 'shell']);
    registerTool({ name: 'agent', source: { kind: 'builtin' } });
    registerTool({ name: 'shell', needsApproval: true, source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [
        {
          role: 'user',
          content: '先看看 git status，再决定怎么修。',
        },
      ],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual(['shell']);
  });

  it('retains agent when global auto-approve makes the sibling tool usable inside delegation', async () => {
    getAppConfigMock.mockReturnValue({
      general: {
        autoApproveToolRequests: true,
      },
    } as never);
    selectToolsWithAgentMock.mockResolvedValue(['agent', 'shell']);
    registerTool({ name: 'agent', source: { kind: 'builtin' } });
    registerTool({ name: 'shell', needsApproval: true, source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [
        {
          role: 'user',
          content: '自己决定要不要分一个子任务去检查本地环境。',
        },
      ],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual(['agent', 'shell']);
  });

  it('reports approval-gated tools as prompt-free to the auto router when global auto-approve is enabled', async () => {
    getAppConfigMock.mockReturnValue({
      general: {
        autoApproveToolRequests: true,
      },
    } as never);
    selectToolsWithAgentMock.mockResolvedValue(['shell']);
    registerTool({ name: 'shell', needsApproval: true, source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [{ role: 'user', content: 'Run a shell command.' }],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual(['shell']);
    expect(selectToolsWithAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        availableTools: [
          expect.objectContaining({
            name: 'shell',
            needsApproval: false,
          }),
        ],
      })
    );
  });

  it('keeps locked-approval tools marked as approval-required even when auto-approve is enabled', async () => {
    getAppConfigMock.mockReturnValue({
      general: {
        autoApproveToolRequests: true,
      },
    } as never);
    selectToolsWithAgentMock.mockResolvedValue(['write_personal_skill']);
    registerTool({
      name: 'write_personal_skill',
      needsApproval: true,
      approvalMode: 'always',
      source: { kind: 'builtin' },
    });

    const result = await resolveToolNames({
      inputMessages: [{ role: 'user', content: 'Update the planner skill.' }],
    });

    expect(result.resolvedTools).toEqual(['write_personal_skill']);
    expect(selectToolsWithAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        availableTools: [
          expect.objectContaining({
            name: 'write_personal_skill',
            needsApproval: true,
          }),
        ],
      })
    );
  });
});
