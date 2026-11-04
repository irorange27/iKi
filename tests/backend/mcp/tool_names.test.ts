// @vitest-environment node
// The model-visible MCP tool name is the tool's identity, so it must stay readable,
// collision-free and reproducible. These tests drive the real tool registry: the same
// object the provider request is built from.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpServer } from '@iki/backend/types/mcp';

const {
  getAppConfigMock,
  serverRows,
  catalogByUrl,
  clientCalls,
  MockClient,
  MockStreamableHTTPClientTransport,
  MockSSEClientTransport,
  MockStdioClientTransport,
} = vi.hoisted(() => {
  const getAppConfigMock = vi.fn(() => ({
    mcp: {
      enabled: true,
      connectOnStartup: false,
      allowRemoteServers: true,
      defaultApprovalMode: 'never' as const,
      requestTimeoutMs: 20_000,
      maxConcurrentRequests: 4,
    },
  }));
  const serverRows = new Map<string, McpServer>();
  const catalogByUrl = new Map<string, Array<Record<string, unknown>>>();
  const clientCalls: Array<{ url: string; toolName: string }> = [];

  class MockStreamableHTTPClientTransport {
    constructor(readonly url: URL) {}

    async close() {
      return undefined;
    }
  }

  class MockSSEClientTransport {
    constructor(readonly url: URL) {}

    async close() {
      return undefined;
    }
  }

  class MockStdioClientTransport {
    constructor(readonly options: Record<string, unknown>) {}

    async close() {
      return undefined;
    }
  }

  class MockClient {
    private transport: { url?: URL } | null = null;

    async connect(transport: { url?: URL }) {
      this.transport = transport;
    }

    async listTools(): Promise<{ tools: Array<Record<string, unknown>> }> {
      return { tools: catalogByUrl.get(String(this.transport?.url)) ?? [] };
    }

    async callTool(request: { name: string }) {
      clientCalls.push({ url: String(this.transport?.url), toolName: request.name });
      return { content: [{ type: 'text', text: 'ok' }] };
    }

    async close() {
      return undefined;
    }
  }

  return {
    getAppConfigMock,
    serverRows,
    catalogByUrl,
    clientCalls,
    MockClient,
    MockStreamableHTTPClientTransport,
    MockSSEClientTransport,
    MockStdioClientTransport,
  };
});

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@iki/backend/db/mcp_servers', () => ({
  addMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  getMcpServer: vi.fn((id: string) => serverRows.get(id) ?? null),
  listMcpServers: vi.fn(() => [...serverRows.values()]),
  updateMcpServer: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockStdioClientTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: MockSSEClientTransport,
}));

import { defaultToolRegistry } from '@iki/backend/tools';
import { McpManager } from '@iki/backend/mcp/manager';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const declareServer = (spec: {
  id: string;
  name: string;
  tools: Array<string | { name: string; title?: string }>;
  allowlist?: string[];
}): string => {
  const url = `https://${spec.id}.example.com/mcp`;
  serverRows.set(spec.id, {
    id: spec.id,
    name: spec.name,
    transport: 'streamable-http',
    base_url: url,
    enabled: true,
    tool_allowlist: spec.allowlist ?? null,
    created_at: '2026-03-19T00:00:00.000Z',
    updated_at: '2026-03-19T00:00:00.000Z',
  });
  catalogByUrl.set(
    url,
    spec.tools.map(tool => {
      const name = typeof tool === 'string' ? tool : tool.name;
      const title = typeof tool === 'string' ? undefined : tool.title;
      return { name, ...(title ? { title } : {}), inputSchema: { type: 'object', properties: {} } };
    })
  );
  return url;
};

const mcpRegistrations = () =>
  defaultToolRegistry.getAll().filter(tool => tool.source?.kind === 'mcp');

const mcpNames = () => mcpRegistrations().map(tool => tool.name).sort();

const nameByOwner = () =>
  Object.fromEntries(
    mcpRegistrations().map(tool => [tool.name, `${tool.source?.id ?? '?'}:${tool.displayName}`])
  );

describe('McpManager model-visible tool naming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverRows.clear();
    catalogByUrl.clear();
    clientCalls.length = 0;
    getAppConfigMock.mockReturnValue({
      mcp: {
        enabled: true,
        connectOnStartup: false,
        allowRemoteServers: true,
        defaultApprovalMode: 'never',
        requestTimeoutMs: 20_000,
        maxConcurrentRequests: 4,
      },
    });
  });

  it('names a tool after its server and its own name, never after a digest', async () => {
    declareServer({ id: 'mcp_alpha', name: 'Alpha Search', tools: ['web_search'] });
    const manager = new McpManager();

    await manager.connectServer('mcp_alpha');

    expect(mcpNames()).toEqual(['mcp_Alpha_Search_web_search']);
    expect(mcpNames()[0]).not.toMatch(/^mcp_[a-f0-9]{8}_/);
  });

  it('gives two servers that expose the same tool name distinct readable names', async () => {
    declareServer({ id: 'mcp_alpha', name: 'GitHub', tools: ['search'] });
    declareServer({ id: 'mcp_beta', name: 'GitHub', tools: ['search'] });
    const manager = new McpManager();

    await manager.connectServer('mcp_beta');
    await manager.connectServer('mcp_alpha');

    expect(mcpNames()).toEqual(['mcp_GitHub_search', 'mcp_GitHub_search_2']);
    // The ordinal comes from the stable registration order (server id), not from the
    // order the servers happened to connect in.
    expect(nameByOwner()).toEqual({
      'mcp_GitHub_search': 'mcp_alpha:search',
      'mcp_GitHub_search_2': 'mcp_beta:search',
    });
  });

  it('reproduces the same names for a new manager after a restart', async () => {
    declareServer({ id: 'mcp_alpha', name: 'GitHub', tools: ['search'] });
    declareServer({ id: 'mcp_beta', name: 'GitHub', tools: ['search'] });

    const firstBoot = new McpManager();
    await firstBoot.connectServer('mcp_beta');
    await firstBoot.connectServer('mcp_alpha');
    const firstNames = nameByOwner();

    await firstBoot.disconnectAll();

    // Connecting in the opposite order must not shuffle the identities.
    const secondBoot = new McpManager();
    await secondBoot.connectServer('mcp_alpha');
    await secondBoot.connectServer('mcp_beta');

    expect(nameByOwner()).toEqual(firstNames);
    expect(Object.keys(nameByOwner()).sort()).toEqual(['mcp_GitHub_search', 'mcp_GitHub_search_2']);
  });

  it('dispatches each name to its own server', async () => {
    const alphaUrl = declareServer({ id: 'mcp_alpha', name: 'GitHub', tools: ['search'] });
    const betaUrl = declareServer({ id: 'mcp_beta', name: 'GitHub', tools: ['search'] });
    const manager = new McpManager();
    await manager.connectServer('mcp_beta');
    await manager.connectServer('mcp_alpha');

    await runWithToolRuntimeContext({}, () =>
      defaultToolRegistry.get('mcp_GitHub_search')?.handler({})
    );
    await runWithToolRuntimeContext({}, () =>
      defaultToolRegistry.get('mcp_GitHub_search_2')?.handler({})
    );

    expect(clientCalls).toEqual([
      { url: alphaUrl, toolName: 'search' },
      { url: betaUrl, toolName: 'search' },
    ]);
  });

  it('re-plans names when a server goes away, and drops its tools', async () => {
    declareServer({ id: 'mcp_alpha', name: 'GitHub', tools: ['search'] });
    declareServer({ id: 'mcp_beta', name: 'GitHub', tools: ['search'] });
    const manager = new McpManager();
    await manager.connectServer('mcp_alpha');
    await manager.connectServer('mcp_beta');

    await manager.disconnectServer('mcp_alpha');

    expect(mcpNames()).toEqual(['mcp_GitHub_search']);
    expect(nameByOwner()).toEqual({ 'mcp_GitHub_search': 'mcp_beta:search' });
  });

  it('resolves a collision inside one server with an ordinal', async () => {
    declareServer({ id: 'mcp_alpha', name: 'Search', tools: ['search?', 'search!'] });
    const manager = new McpManager();

    await manager.connectServer('mcp_alpha');

    const names = mcpNames();
    expect(names).toEqual(['mcp_Search_search', 'mcp_Search_search_2']);
    expect(names.every(name => name.startsWith('mcp_'))).toBe(true);
  });

  it('keeps a long name inside the provider charset and length limit', async () => {
    declareServer({
      id: 'mcp_alpha',
      name: 'Very Long MCP Server Name That Goes On And On',
      tools: ['a_very_long_tool_name_that_keeps_going_and_going_and_going_on'],
    });
    const manager = new McpManager();

    await manager.connectServer('mcp_alpha');

    const [name] = mcpNames();
    expect(name).toMatch(TOOL_NAME_PATTERN);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith('mcp_Very_Long_MCP_Server')).toBe(true);
  });

  it('falls back to the server id when a server name has no usable characters', async () => {
    declareServer({ id: 'mcp_alpha', name: '   ', tools: ['search'] });
    const manager = new McpManager();

    await manager.connectServer('mcp_alpha');

    expect(mcpNames()).toEqual(['mcp_mcp_alpha_search']);
  });

  it('keeps the display title from the catalog instead of the internal name', async () => {
    declareServer({ id: 'mcp_alpha', name: 'Alpha', tools: [{ name: 'web_search', title: 'Web Search' }] });
    const manager = new McpManager();

    await manager.connectServer('mcp_alpha');

    const tool = defaultToolRegistry.get('mcp_Alpha_web_search');
    expect(tool?.displayName).toBe('Web Search');
    expect(tool?.source).toEqual({ kind: 'mcp', id: 'mcp_alpha', name: 'Alpha' });
  });

  it('honours the tool allowlist when planning names', async () => {
    declareServer({ id: 'mcp_alpha', name: 'Alpha', tools: ['keep', 'drop'], allowlist: ['keep'] });
    const manager = new McpManager();

    await manager.connectServer('mcp_alpha');

    expect(mcpNames()).toEqual(['mcp_Alpha_keep']);
  });
});
