import { afterEach, describe, expect, it } from 'vitest';

import { createTool, defaultToolRegistry } from '../../../../src/core/tools';
import { resolveToolNames } from '../../../../src/main/services/chat/chat_tools';

const TEST_TOOL_NAMES = [
  'web',
  'fetch',
  'shell',
  'list_dir',
  'read_file',
  'write_file',
  'delete_file',
  'mcp_alpha_safe',
  'mcp_beta_unsafe',
  'manual_only',
  'list_todo_lists',
  'read_todo_list',
  'write_todo_list',
  'delete_todo_list',
];

const registerTool = (options: {
  name: string;
  autoAllowed?: boolean;
  source?: { kind: 'builtin' | 'mcp'; id?: string; name?: string };
}) => {
  defaultToolRegistry.register(
    createTool({
      name: options.name,
      type: 'function',
      description: `Tool ${options.name}`,
      parameters: { type: 'object', properties: {} },
      autoAllowed: options.autoAllowed,
      source: options.source,
      handler: async () => ({ ok: true }),
    })
  );
};

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
      'write_file',
      'delete_file',
    ]);
  });

  it('includes todo list tools in auto mode for normal chat turns', async () => {
    registerTool({ name: 'list_todo_lists', source: { kind: 'builtin' } });
    registerTool({ name: 'read_todo_list', source: { kind: 'builtin' } });
    registerTool({ name: 'write_todo_list', source: { kind: 'builtin' } });
    registerTool({ name: 'delete_todo_list', source: { kind: 'builtin' } });

    const result = await resolveToolNames({
      inputMessages: [],
    });

    expect(result.mode).toBe('auto');
    expect(result.resolvedTools).toEqual([
      'list_todo_lists',
      'read_todo_list',
      'write_todo_list',
      'delete_todo_list',
    ]);
  });
});
