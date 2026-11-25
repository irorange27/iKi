import { getAppConfig, setAppConfig } from '@iki/harness/config';
import {
  findDefaultMcpJsonPath,
  readMcpJsonFile,
  type McpManager,
} from '@iki/harness/mcp';
import { formatMcpToolCompactSignature } from '@iki/harness/tools';
import type { McpServerSummary } from '@iki/core/types/mcp';
import type { InteractiveCliState, SlashCommandOutcome } from './commands';

const clipText = (text: string, max = 84): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
};

const splitArgs = (input: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
};

const formatMcpUsageLines = (): string[] => [
  'Usage:',
  '  /mcp                           Show configured MCP servers, mode & connected tools',
  '  /mcp tools                     List active MCP TypeScript APIs (mcp.<server>.<tool>)',
  '  /mcp dts [server] [tool]       Preview generated TypeScript (.d.ts) declarations for PTC',
  '  /mcp mode [code|direct]        Switch exposure mode (code=KV-cache-safe TS API; direct=top-level tools)',
  '  /mcp enable | disable          Toggle [mcp].enabled in settings.toml',
  '  /mcp add <name> <cmd> [args]   Add a local stdio MCP server and connect',
  '  /mcp add-http <name> <url>     Add a streamable-http MCP server and connect',
  '  /mcp import [mcp.json]         Import Claude/Cursor-format mcp.json servers',
  '  /mcp connect <name|id>         Connect a configured MCP server',
  '  /mcp disconnect <name|id>      Disconnect an MCP server',
  '  /mcp refresh <name|id>         Refresh tool catalog for a connected server',
  '  /mcp remove <name|id>          Disconnect and remove an MCP server',
];

const findServerByNameOrId = (
  servers: readonly McpServerSummary[],
  ref: string
): McpServerSummary | undefined => {
  const key = ref.trim().toLowerCase();
  if (!key) return undefined;
  return (
    servers.find(s => s.id.toLowerCase() === key) ??
    servers.find(s => s.name.toLowerCase() === key)
  );
};

const ensureMcpEnabled = (): void => {
  const cfg = getAppConfig();
  if (!cfg.mcp.enabled) {
    setAppConfig({
      ...cfg,
      mcp: { ...cfg.mcp, enabled: true },
    });
  }
};

export const formatMcpBannerSummary = (
  mcpManager: McpManager | undefined,
  options?: { workspacePath?: string; dataDir?: string }
): string => {
  if (!mcpManager) return 'not initialized';
  const cfg = getAppConfig().mcp;
  const servers = mcpManager.listServers();
  const connected = mcpManager.getConnectedServerIds().length;
  const tools = mcpManager.listRegisteredTools().length;
  if (!cfg.enabled && servers.length === 0) {
    const discovered =
      options?.workspacePath || options?.dataDir
        ? findDefaultMcpJsonPath({
            workspacePath: options.workspacePath,
            dataDir: options.dataDir,
          })
        : null;
    if (discovered) return `disabled · found mcp.json (run /mcp import)`;
    return 'disabled (use /mcp add or /mcp import)';
  }
  return `${cfg.enabled ? 'enabled' : 'disabled'} · mode=${cfg.exposureMode} · ${connected}/${servers.length} connected · ${tools} tool(s)`;
};

export const getMcpSlashCompletions = (
  mcpManager: McpManager | undefined,
  prefix: string
): Array<{ value: string; label: string; description?: string }> | null => {
  const lower = prefix.toLowerCase();
  const servers = mcpManager?.listServers() ?? [];
  const candidates = [
    { value: 'status', label: 'status', description: 'List MCP servers, mode & connection status' },
    { value: 'tools', label: 'tools', description: 'List active MCP TypeScript APIs' },
    { value: 'dts', label: 'dts [server]', description: 'Show generated MCP TypeScript (.d.ts) declarations' },
    { value: 'mode code', label: 'mode code', description: 'KV-cache-friendly Code Mode (progressive disclosure via ptc)' },
    { value: 'mode direct', label: 'mode direct', description: 'Legacy direct mode (expose mcp_* as top-level tools)' },
    { value: 'enable', label: 'enable', description: 'Enable MCP in settings.toml' },
    { value: 'disable', label: 'disable', description: 'Disable MCP and disconnect all' },
    { value: 'add ', label: 'add <name> <cmd> [args]', description: 'Add stdio MCP server' },
    { value: 'add-http ', label: 'add-http <name> <url>', description: 'Add HTTP MCP server' },
    { value: 'import', label: 'import [path]', description: 'Import standard mcp.json' },
    ...servers.flatMap(s => [
      { value: `dts ${s.name}`, label: `dts ${s.name}`, description: 'Show TS declarations for server' },
      { value: `connect ${s.name}`, label: `connect ${s.name}`, description: `${s.transport} (${s.status?.state ?? 'disconnected'})` },
      { value: `disconnect ${s.name}`, label: `disconnect ${s.name}`, description: s.id },
      { value: `refresh ${s.name}`, label: `refresh ${s.name}`, description: 'Refresh tool catalog' },
      { value: `remove ${s.name}`, label: `remove ${s.name}`, description: 'Delete server' },
    ]),
  ].filter(item => !lower || item.value.toLowerCase().includes(lower));
  return candidates.length ? candidates : null;
};

export const executeMcpSlashCommand = async (
  arg: string,
  state: InteractiveCliState
): Promise<SlashCommandOutcome> => {
  const mcp = state.mcpManager;
  if (!mcp) {
    return { kind: 'handled', lines: ['MCP runtime is not initialized in this CLI session.'] };
  }

  const trimmed = arg.trim();
  const tokens = splitArgs(trimmed);
  const sub = (tokens[0] ?? 'status').toLowerCase();

  if (sub === 'help') {
    return { kind: 'handled', lines: formatMcpUsageLines() };
  }

  if (sub === 'status') {
    const cfg = getAppConfig().mcp;
    const servers = mcp.listServers();
    const tools = mcp.listRegisteredTools();
    if (servers.length === 0) {
      return {
        kind: 'handled',
        lines: [
          `MCP (${cfg.enabled ? 'enabled' : 'disabled'}, mode=${cfg.exposureMode}) — no servers configured.`,
          ...formatMcpUsageLines(),
        ],
      };
    }
    const lines = [
      `MCP (${cfg.enabled ? 'enabled' : 'disabled'}, mode=${cfg.exposureMode}, ${mcp.getConnectedServerIds().length}/${servers.length} connected, ${tools.length} tool(s)):`,
    ];
    for (const s of servers) {
      const st = s.status?.state ?? 'disconnected';
      const count = s.status?.toolCount ?? 0;
      const target = s.transport === 'stdio'
        ? [s.command ?? '', ...(s.args ?? [])].join(' ').trim()
        : (s.base_url ?? '');
      const errPart = s.status?.lastError ? ` · err: ${clipText(s.status.lastError, 48)}` : '';
      lines.push(
        `  ${s.name.padEnd(16)} [${st} · ${count} tools]  ${s.transport}  ${clipText(target, 56)}${errPart}`
      );
    }
    return { kind: 'handled', lines };
  }

  if (sub === 'mode') {
    const cfg = getAppConfig();
    const next = tokens[1]?.toLowerCase();
    if (!next) {
      return {
        kind: 'handled',
        lines: [
          `Current MCP exposure mode: ${cfg.mcp.exposureMode}`,
          '  code   — KV-cache-friendly progressive disclosure; model calls `await mcp.<server>.<tool>(args)` inside `ptc` (default)',
          '  direct — Legacy mode; expose all `mcp_*` JSON schemas directly in top-level LLM tools',
          'Switch with: /mcp mode code  or  /mcp mode direct',
        ],
      };
    }
    if (next !== 'code' && next !== 'direct') {
      return { kind: 'handled', lines: ['Usage: /mcp mode [code|direct]'] };
    }
    setAppConfig({ ...cfg, mcp: { ...cfg.mcp, exposureMode: next } });
    return {
      kind: 'handled',
      lines: [
        `Set [mcp].exposureMode = ${next} (${next === 'code' ? 'KV-cache-safe TS API via ptc' : 'direct top-level mcp_* tools'}).`,
      ],
    };
  }

  if (sub === 'dts') {
    const serverRef = tokens[1];
    const toolRef = tokens[2];
    const dts = mcp.renderNamespaceDts(serverRef, toolRef);
    return {
      kind: 'handled',
      lines: dts.split('\n'),
    };
  }

  if (sub === 'tools') {
    const cfg = getAppConfig().mcp;
    const catalog = mcp.listConnectedServerCatalog();
    const total = catalog.reduce((sum, s) => sum + s.tools.length, 0);
    if (total === 0) {
      return { kind: 'handled', lines: ['No active MCP tools. Connect a server with `/mcp connect <name>`.'] };
    }
    const lines = [
      `Active MCP APIs (${total} tool(s), mode=${cfg.exposureMode}) — run \`/mcp dts [server]\` for full TS declarations:`,
    ];
    for (const server of catalog) {
      lines.push(`  [${server.safeName}] (${server.tools.length} tool(s))`);
      for (const tool of server.tools) {
        const sig = formatMcpToolCompactSignature(tool);
        const desc = tool.description ? ` — ${clipText(tool.description, 72)}` : '';
        lines.push(`    mcp.${server.safeName}.${sig}${desc}`);
      }
    }
    return { kind: 'handled', lines };
  }

  if (sub === 'enable') {
    ensureMcpEnabled();
    await mcp.initialize();
    return { kind: 'handled', lines: [`MCP enabled (${formatMcpBannerSummary(mcp)}).`] };
  }

  if (sub === 'disable') {
    const cfg = getAppConfig();
    setAppConfig({ ...cfg, mcp: { ...cfg.mcp, enabled: false } });
    await mcp.disconnectAll();
    return { kind: 'handled', lines: ['MCP disabled and disconnected all servers.'] };
  }

  if (sub === 'add') {
    const [, name, command, ...cmdArgs] = tokens;
    if (!name || !command) {
      return { kind: 'handled', lines: ['Usage: /mcp add <name> <command> [args...]'] };
    }
    try {
      ensureMcpEnabled();
      const created = await mcp.addServer({
        name,
        transport: 'stdio',
        command,
        args: cmdArgs,
        enabled: true,
        ...(state.workspace ? { cwd: state.workspace } : {}),
      });
      const summary = mcp.listServers().find(s => s.id === created.id);
      return {
        kind: 'handled',
        lines: [
          `Added & connected stdio MCP server "${created.name}" (${created.id}, ${summary?.status?.toolCount ?? 0} tool(s)).`,
        ],
      };
    } catch (error) {
      return { kind: 'handled', lines: [`Failed to add MCP server: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  if (sub === 'add-http') {
    const [, name, url] = tokens;
    if (!name || !url) {
      return { kind: 'handled', lines: ['Usage: /mcp add-http <name> <url>'] };
    }
    try {
      ensureMcpEnabled();
      const created = await mcp.addServer({
        name,
        transport: 'streamable-http',
        base_url: url,
        enabled: true,
      });
      const summary = mcp.listServers().find(s => s.id === created.id);
      return {
        kind: 'handled',
        lines: [
          `Added & connected HTTP MCP server "${created.name}" (${created.id}, ${summary?.status?.toolCount ?? 0} tool(s)).`,
        ],
      };
    } catch (error) {
      return { kind: 'handled', lines: [`Failed to add HTTP MCP server: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  if (sub === 'import') {
    const explicitPath = tokens[1];
    const targetPath =
      explicitPath ??
      findDefaultMcpJsonPath({ workspacePath: state.workspace, dataDir: state.dataDir });
    if (!targetPath) {
      return {
        kind: 'handled',
        lines: [
          'No mcp.json found (checked <workspace>/.mcp.json, <workspace>/.iki/mcp.json, <dataDir>/mcp.json).',
          'Pass an explicit path: /mcp import /path/to/mcp.json',
        ],
      };
    }
    try {
      const specs = readMcpJsonFile(targetPath);
      if (specs.length === 0) {
        return { kind: 'handled', lines: [`No MCP servers defined in ${targetPath}.`] };
      }
      ensureMcpEnabled();
      const existing = mcp.listServers();
      const lines = [`Importing ${specs.length} server(s) from ${targetPath}:`];
      for (const spec of specs) {
        const match = existing.find(s => s.name.toLowerCase() === spec.name.toLowerCase());
        try {
          if (match) {
            await mcp.updateServer(match.id, spec);
            lines.push(`  updated ${spec.name} (${spec.transport})`);
          } else {
            await mcp.addServer(spec);
            lines.push(`  added ${spec.name} (${spec.transport})`);
          }
        } catch (err) {
          lines.push(`  ${spec.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      lines.push(`Now: ${formatMcpBannerSummary(mcp)}`);
      return { kind: 'handled', lines };
    } catch (error) {
      return { kind: 'handled', lines: [`Failed to import mcp.json: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  const targetRef = tokens.slice(1).join(' ').trim();
  const target = findServerByNameOrId(mcp.listServers(), targetRef);
  if (!targetRef || !target) {
    return {
      kind: 'handled',
      lines: [targetRef ? `Unknown MCP server "${targetRef}".` : `Usage: /mcp ${sub} <name|id>`],
    };
  }

  try {
    if (sub === 'connect') {
      ensureMcpEnabled();
      const st = await mcp.connectServer(target.id, { force: true });
      return { kind: 'handled', lines: [`Connected "${target.name}" (${st.toolCount} tool(s)).`] };
    }
    if (sub === 'disconnect') {
      await mcp.disconnectServer(target.id);
      return { kind: 'handled', lines: [`Disconnected "${target.name}".`] };
    }
    if (sub === 'refresh') {
      const tools = await mcp.refreshTools(target.id);
      return { kind: 'handled', lines: [`Refreshed "${target.name}": ${tools.length} tool(s).`] };
    }
    if (sub === 'remove' || sub === 'delete') {
      await mcp.deleteServer(target.id);
      return { kind: 'handled', lines: [`Removed MCP server "${target.name}".`] };
    }
  } catch (error) {
    return { kind: 'handled', lines: [`MCP ${sub} failed: ${error instanceof Error ? error.message : String(error)}`] };
  }

  return { kind: 'handled', lines: formatMcpUsageLines() };
};
