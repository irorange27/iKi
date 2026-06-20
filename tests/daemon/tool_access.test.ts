import { afterEach, describe, expect, it } from 'vitest';

import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import {
  readRequestedMcpServerIds,
  resolveMcpServerIdsForClient,
  resolveToolsForClient,
} from '@iki/daemon/tool_access';

const TEST_MCP_TOOL_NAMES = ['mcp_alpha_lookup', 'mcp_beta_lookup'];

const registerMcpTool = (name: string, serverId: string) => {
  defaultToolRegistry.register(
    createTool({
      name,
      type: 'function',
      description: `MCP tool ${name}`,
      parameters: { type: 'object', properties: {} },
      source: { kind: 'mcp', id: serverId, name: `Server ${serverId}` },
      handler: async () => ({ ok: true }),
    })
  );
};

afterEach(() => {
  for (const toolName of TEST_MCP_TOOL_NAMES) {
    defaultToolRegistry.remove(toolName);
  }
});

describe('tool_access', () => {
  it('uses the broader auto-capable builtin defaults when client omits tool names', () => {
    expect(resolveToolsForClient(undefined, ['web', 'fetch', 'shell', 'agent'])).toEqual([
      'web',
      'fetch',
      'shell',
      'agent',
    ]);
  });

  it('treats explicit empty tool arrays as an intentional disable', () => {
    expect(resolveToolsForClient([], ['web', 'fetch', 'shell'])).toEqual([]);
  });

  it('reads requested MCP server ids from camelCase and snake_case payload fields', () => {
    expect(readRequestedMcpServerIds({ mcpServerIds: ['alpha', 'beta'] })).toEqual(['alpha', 'beta']);
    expect(readRequestedMcpServerIds({ mcp_server_ids: ['alpha', 'beta'] })).toEqual([
      'alpha',
      'beta',
    ]);
    expect(readRequestedMcpServerIds({ tools: ['web'] })).toBeUndefined();
  });

  it('allows all requested MCP server ids when mcp:* is in allowlist', () => {
    const resolved = resolveMcpServerIdsForClient(['alpha', 'beta'], ['web', 'mcp:*']);
    expect(resolved).toEqual(['alpha', 'beta']);
  });

  it('defaults omitted MCP server ids to all currently allowed MCP servers', () => {
    registerMcpTool('mcp_alpha_lookup', 'alpha');
    registerMcpTool('mcp_beta_lookup', 'beta');

    expect(resolveMcpServerIdsForClient(undefined, ['mcp:*'])).toEqual(['alpha', 'beta']);
  });

  it('treats explicit empty MCP server arrays as an intentional disable', () => {
    expect(resolveMcpServerIdsForClient([], ['mcp:*'])).toEqual([]);
  });

  it('allows only explicitly scoped MCP server ids when mcp:server:<id> is used', () => {
    const resolved = resolveMcpServerIdsForClient(['alpha', 'beta'], ['mcp:server:alpha']);
    expect(resolved).toEqual(['alpha']);
  });

  it('permits explicit MCP tool names when the server token authorizes that server', () => {
    registerMcpTool('mcp_alpha_lookup', 'alpha');

    const resolved = resolveToolsForClient(['mcp_alpha_lookup'], ['mcp:server:alpha']);
    expect(resolved).toEqual(['mcp_alpha_lookup']);
  });

  it('derives MCP server permissions from explicitly allowed MCP tool names', () => {
    registerMcpTool('mcp_alpha_lookup', 'alpha');
    registerMcpTool('mcp_beta_lookup', 'beta');

    const resolved = resolveMcpServerIdsForClient(['alpha', 'beta'], ['mcp_alpha_lookup']);
    expect(resolved).toEqual(['alpha']);
  });

  it('rejects requested MCP server ids when client has no MCP permission', () => {
    const resolved = resolveMcpServerIdsForClient(['alpha'], ['web', 'fetch']);
    expect(resolved).toEqual([]);
  });
});
