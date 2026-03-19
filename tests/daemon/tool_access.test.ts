import { afterEach, describe, expect, it } from 'vitest';

import { createTool, defaultToolRegistry } from '../../src/core/tools';
import {
  readRequestedMcpServerIds,
  resolveMcpServerIdsForClient,
  resolveToolsForClient,
} from '../../src/daemon/tool_access';

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
  it('uses low-risk defaults when client omits tool names', () => {
    expect(resolveToolsForClient(undefined, ['web', 'fetch', 'shell'])).toEqual(['web', 'fetch']);
  });

  it('reads requested MCP server ids from camelCase and snake_case payload fields', () => {
    expect(readRequestedMcpServerIds({ mcpServerIds: ['alpha', 'beta'] })).toEqual(['alpha', 'beta']);
    expect(readRequestedMcpServerIds({ mcp_server_ids: ['alpha', 'beta'] })).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('allows all requested MCP server ids when mcp:* is in allowlist', () => {
    const resolved = resolveMcpServerIdsForClient(['alpha', 'beta'], ['web', 'mcp:*']);
    expect(resolved).toEqual(['alpha', 'beta']);
  });

  it('allows only explicitly scoped MCP server ids when mcp:server:<id> is used', () => {
    const resolved = resolveMcpServerIdsForClient(['alpha', 'beta'], ['mcp:server:alpha']);
    expect(resolved).toEqual(['alpha']);
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
