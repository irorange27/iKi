import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppConfigMock,
  streamableTransportInstances,
  sseTransportInstances,
  MockClient,
  MockStdioClientTransport,
  MockStreamableHTTPClientTransport,
  MockSSEClientTransport,
} = vi.hoisted(() => {
  const streamableTransportInstances: Array<{ url: URL; options: Record<string, unknown> }> = [];
  const sseTransportInstances: Array<{ url: URL; options: Record<string, unknown> }> = [];
  const getAppConfigMock = vi.fn(() => ({
    mcp: {
      enabled: true,
      connectOnStartup: false,
      allowRemoteServers: true,
      defaultApprovalMode: 'safe-only' as const,
      requestTimeoutMs: 20_000,
      maxConcurrentRequests: 4,
    },
  }));

  class MockStreamableHTTPClientTransport {
    url: URL;
    options: Record<string, unknown>;

    constructor(url: URL, options: Record<string, unknown>) {
      this.url = url;
      this.options = options;
      streamableTransportInstances.push({ url, options });
    }

    async close() {}
  }

  class MockSSEClientTransport {
    url: URL;
    options: Record<string, unknown>;

    constructor(url: URL, options: Record<string, unknown>) {
      this.url = url;
      this.options = options;
      sseTransportInstances.push({ url, options });
    }

    async close() {}
  }

  class MockStdioClientTransport {
    constructor(readonly options: Record<string, unknown>) {}

    async close() {}
  }

  class MockClient {
    async connect() {}
    async listTools() {
      return { tools: [] };
    }
    async callTool() {
      return { content: [] };
    }
    async close() {}
  }

  return {
    getAppConfigMock,
    streamableTransportInstances,
    sseTransportInstances,
    MockClient,
    MockStdioClientTransport,
    MockStreamableHTTPClientTransport,
    MockSSEClientTransport,
  };
});

vi.mock('../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../src/core/db/mcp_servers', () => ({
  addMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  getMcpServer: vi.fn(),
  listMcpServers: vi.fn(() => []),
  updateMcpServer: vi.fn(),
}));

vi.mock('../../../src/core/tools', () => ({
  createTool: vi.fn((options: Record<string, unknown>) => options),
  defaultToolRegistry: {
    register: vi.fn(),
    removeBySource: vi.fn(),
  },
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

import { McpManager } from '../../../src/core/mcp/manager';
import type { McpServer } from '../../../src/shared/types/mcp';

const createRemoteServer = (transport: McpServer['transport']): McpServer => ({
  id: 'server_remote',
  name: 'Remote MCP',
  transport,
  base_url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer secret' },
  enabled: true,
  created_at: '2026-03-19T00:00:00.000Z',
  updated_at: '2026-03-19T00:00:00.000Z',
});

describe('McpManager transport construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamableTransportInstances.length = 0;
    sseTransportInstances.length = 0;
    getAppConfigMock.mockReturnValue({
      mcp: {
        enabled: true,
        connectOnStartup: false,
        allowRemoteServers: true,
        defaultApprovalMode: 'safe-only',
        requestTimeoutMs: 20_000,
        maxConcurrentRequests: 4,
      },
    });
  });

  it('uses redirect:error for streamable HTTP transports', async () => {
    const manager = new McpManager();

    await (manager as any).buildTransport(createRemoteServer('streamable-http'));

    expect(streamableTransportInstances).toHaveLength(1);
    expect(streamableTransportInstances[0]?.options).toEqual({
      requestInit: {
        headers: { Authorization: 'Bearer secret' },
        redirect: 'error',
      },
    });
  });

  it('uses redirect:error and forwards headers for SSE transports', async () => {
    const manager = new McpManager();

    await (manager as any).buildTransport(createRemoteServer('sse'));

    expect(sseTransportInstances).toHaveLength(1);
    expect(sseTransportInstances[0]?.options).toMatchObject({
      requestInit: {
        headers: { Authorization: 'Bearer secret' },
        redirect: 'error',
      },
    });
    expect(
      typeof (sseTransportInstances[0]?.options.eventSourceInit as { fetch?: unknown } | undefined)
        ?.fetch
    ).toBe('function');
  });

  it('blocks remote HTTP transports when remote servers are disabled', async () => {
    getAppConfigMock.mockReturnValue({
      mcp: {
        enabled: true,
        connectOnStartup: false,
        allowRemoteServers: false,
        defaultApprovalMode: 'safe-only',
        requestTimeoutMs: 20_000,
        maxConcurrentRequests: 4,
      },
    });

    const manager = new McpManager();

    await expect((manager as any).buildTransport(createRemoteServer('streamable-http'))).rejects.toThrow(
      /remote mcp servers are disabled/i
    );
  });
});
