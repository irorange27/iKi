import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { addChatThread } from '@iki/store/chat_thread';
import { initializeDatabase } from '@iki/store/database';
import { getAppConfig, setAppConfig } from '../src/config';
import { parseMcpJsonConfig, resolveMcpAnchoredReminders } from '../src/mcp';
import { McpManager } from '../src/mcp/manager';
import {
  defaultToolRegistry,
  registerStandardTools,
  type PtcMcpServerDescriptor,
} from '../src/tools';
import { createChatTurnPreparer } from '../src/turn_prep/turn_preparer';

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MCP stdio server + PTC end-to-end orchestration', () => {
  it('parses standard mcp.json, connects a real stdio MCP server, and orchestrates its tools via ptc', async () => {
    const dataDir = makeTempDir('iki-mcp-ptc-data-');
    const serverDir = makeTempDir('iki-mcp-ptc-srv-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const cfg = getAppConfig();
    setAppConfig({ ...cfg, mcp: { ...cfg.mcp, enabled: true } });

    // Create a minimal real stdio MCP server using the installed @modelcontextprotocol/sdk
    const require = createRequire(import.meta.url);
    const sdkServerUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/index.js')).href;
    const sdkStdioUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href;
    const sdkTypesUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/types.js')).href;
    const serverScript = path.join(serverDir, 'demo_mcp_server.mjs');
    fs.writeFileSync(
      serverScript,
      `
import { Server } from ${JSON.stringify(sdkServerUrl)};
import { StdioServerTransport } from ${JSON.stringify(sdkStdioUrl)};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(sdkTypesUrl)};

const server = new Server({ name: 'demo-calc', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'add',
      description: 'Add two numbers a and b',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
      annotations: { readOnlyHint: true },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'add') {
    const { a, b } = req.params.arguments ?? {};
    return { content: [{ type: 'text', text: String(Number(a) + Number(b)) }] };
  }
  throw new Error('Unknown tool');
});

const transport = new StdioServerTransport();
await server.connect(transport);
`,
      'utf8'
    );

    const parsedSpecs = parseMcpJsonConfig(
      JSON.stringify({
        mcpServers: {
          calc: {
            command: process.execPath,
            args: [serverScript],
          },
        },
      })
    );
    expect(parsedSpecs).toHaveLength(1);
    expect(parsedSpecs[0]).toMatchObject({ name: 'calc', transport: 'stdio' });

    registerStandardTools();
    const mcp = new McpManager();
    try {
      const server = await mcp.addServer(parsedSpecs[0]!);
      expect(mcp.getConnectedServerIds()).toEqual([server.id]);
      const mcpTools = mcp.listRegisteredTools();
      expect(mcpTools.map(t => t.name)).toContain('mcp_calc_add');

      // Invoke MCP tool inside a TypeScript PTC script via Code Mode (`mcp.<server>.<tool>`) in parallel
      const ptcTool = defaultToolRegistry.get('ptc');
      expect(ptcTool).toBeTruthy();

      const ptcOut = (await ptcTool!.handler({
        language: 'ts',
        code: `
          const dts: string = mcp.describe('calc');
          const sums = await Promise.all([
            mcp.calc.add({ a: 10, b: 20 }),
            mcp.calc.add({ a: 3, b: 7 }),
          ]);
          const values: number[] = sums.map((r: { text?: string }) => Number(r.text));
          return {
            hasDts: dts.includes('declare namespace mcp.calc'),
            values,
            grandTotal: values[0] + values[1],
          };
        `,
      })) as {
        ok: boolean;
        result: { hasDts: boolean; values: number[]; grandTotal: number };
        toolCallCount: number;
        toolCalls: Array<{ name: string; ok: boolean }>;
      };

      expect(ptcOut.ok).toBe(true);
      expect(ptcOut.toolCallCount).toBe(2);
      expect(ptcOut.toolCalls.map(c => c.name)).toEqual(['mcp.calc.add', 'mcp.calc.add']);
      expect(ptcOut.result).toEqual({ hasDts: true, values: [30, 10], grandTotal: 40 });
    } finally {
      await mcp.disconnectAll();
    }
    expect(mcp.getConnectedServerIds()).toEqual([]);
  });

  it('delivers progressive cache-safe MCP delta reminders and freezes top-level tools in Code Mode', async () => {
    const dataDir = makeTempDir('iki-mcp-code-mode-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();
    registerStandardTools();

    const threadId = 'thread_mcp_code_mode';
    addChatThread({
      id: threadId,
      title: 'MCP Code Mode Test',
      provider_type: 'openai',
      model: 'gpt-4o-mini',
    });

    const smallCatalog: PtcMcpServerDescriptor[] = [
      {
        id: 'mcp_calc',
        name: 'calc',
        safeName: 'calc',
        tools: [
          {
            name: 'add',
            safeName: 'add',
            description: 'Add two numbers',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
        ],
      },
    ];

    // Turn 1: small server -> compact TS signature inlined in L0 reminder
    const turn1 = resolveMcpAnchoredReminders({
      threadId,
      currentUserAnchor: 'u1',
      catalogOverride: smallCatalog,
    });
    expect(turn1).toHaveLength(1);
    expect(turn1[0]!.beforeAnchor).toBe('u1');
    expect(turn1[0]!.text).toContain('<system_reminder name="mcp">');
    expect(turn1[0]!.text).toContain('mcp.calc.add({ a: number; b: number })');

    // Turn 2: unchanged catalog -> zero new reminders (KV-cache prefix frozen!)
    const turn2 = resolveMcpAnchoredReminders({
      threadId,
      currentUserAnchor: 'u2',
      catalogOverride: smallCatalog,
    });
    expect(turn2).toEqual(turn1);

    // Turn 3: add a large server (>6 tools) -> emits tool-name index + mcp.describe hint (no schema dump)
    const bigServer: PtcMcpServerDescriptor = {
      id: 'mcp_gh',
      name: 'github',
      safeName: 'github',
      tools: Array.from({ length: 8 }, (_, i) => ({
        name: `tool_${i}`,
        safeName: `tool_${i}`,
        description: `GitHub tool ${i}`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      })),
    };
    const turn3 = resolveMcpAnchoredReminders({
      threadId,
      currentUserAnchor: 'u3',
      catalogOverride: [...smallCatalog, bigServer],
    });
    expect(turn3).toHaveLength(2);
    expect(turn3[1]!.beforeAnchor).toBe('u3');
    expect(turn3[1]!.text).toContain('mcp.describe("github")');
    expect(turn3[1]!.text).not.toContain('mcp.calc.add'); // calc was already delivered!

    // Turn 4: disconnect github -> removal delta anchored at u4; earlier anchors intact
    const turn4 = resolveMcpAnchoredReminders({
      threadId,
      currentUserAnchor: 'u4',
      catalogOverride: smallCatalog,
    });
    expect(turn4).toHaveLength(3);
    expect(turn4[2]!.beforeAnchor).toBe('u4');
    expect(turn4[2]!.text).toContain('Disconnected MCP servers: github');

    // Verify turn_preparer freezes top-level guardedTools in `code` mode vs exposes in `direct` mode
    defaultToolRegistry.register({
      name: 'mcp_calc_add',
      type: 'function',
      description: 'Add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      autoAllowed: true,
      source: { kind: 'mcp', id: 'mcp_calc', name: 'calc' },
      handler: async () => ({ content: [{ type: 'text', text: '3' }] }),
    });

    try {
      const noSkills = async () => ({
        skillsSystemPrompt: '',
        usedSkills: [],
        skillMode: 'manual' as const,
      });

      const codePreparer = createChatTurnPreparer({
        getRuntimeConfig: () => ({
          autoApproveToolRequests: true,
          contextBudget: null,
          mcpExposureMode: 'code',
        }),
        resolveSkillsSystemPrompt: noSkills,
        resolveMcpReminders: p =>
          resolveMcpAnchoredReminders({ ...p, catalogOverride: smallCatalog }),
      });

      const codeTurn = await codePreparer.prepareChatTurn({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        threadId: 'thread_prep_code',
        mcpServerIds: ['mcp_calc'],
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      });
      expect(codeTurn.guardedTools).toContain('ptc');
      expect(codeTurn.guardedTools.some(t => t.startsWith('mcp_'))).toBe(false);
      expect(
        codeTurn.finalMessages.some(
          m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<system_reminder name="mcp">')
        )
      ).toBe(true);

      const directPreparer = createChatTurnPreparer({
        getRuntimeConfig: () => ({
          autoApproveToolRequests: true,
          contextBudget: null,
          mcpExposureMode: 'direct',
        }),
        resolveSkillsSystemPrompt: noSkills,
        resolveMcpReminders: p =>
          resolveMcpAnchoredReminders({ ...p, catalogOverride: smallCatalog }),
      });

      const directTurn = await directPreparer.prepareChatTurn({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        threadId: 'thread_prep_direct',
        mcpServerIds: ['mcp_calc'],
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      });
      expect(directTurn.guardedTools).toContain('mcp_calc_add');
      expect(
        directTurn.finalMessages.some(
          m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<system_reminder name="mcp">')
        )
      ).toBe(false);
    } finally {
      defaultToolRegistry.removeBySource(s => s?.kind === 'mcp');
    }
  });
});
