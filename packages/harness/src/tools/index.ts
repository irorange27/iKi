export * from './base';
export * from '@iki/tools/shell';
export * from '@iki/tools/swarm';
export * from '@iki/tools/ptc';

import { getAppConfig } from '@iki/harness/config';
import { createShellTools, registerShellTools, type ShellToolPluginDeps } from '@iki/tools/shell';
import { registerSwarmTools as registerSwarmToolsPlugin, type SwarmRuntimePort } from '@iki/tools/swarm';
import {
  createPtcTools,
  registerPtcTools,
  type PtcMcpServerDescriptor,
  type PtcToolPluginDeps,
} from '@iki/tools/ptc';
import { defaultToolRegistry } from './base';
import { resolveShellWorkingDirectory } from './workspace_paths';

export type PtcMcpBridge = {
  listMcpServers: () => PtcMcpServerDescriptor[];
  invokeMcpTool: (serverRef: string, toolRef: string, args: unknown) => Promise<unknown>;
};

let activePtcMcpBridge: PtcMcpBridge | null = null;

/** Registers the live MCP runtime bridge for PTC's `mcp.<server>.<tool>()` namespace without creating a tools -> mcp cycle. */
export const setPtcMcpBridge = (bridge: PtcMcpBridge | null): void => {
  activePtcMcpBridge = bridge;
};

const readHostShellSettings = () => {
  try {
    return getAppConfig().tools.shell;
  } catch {
    return undefined;
  }
};

const readHostPtcSettings = () => {
  try {
    return getAppConfig().tools.ptc;
  } catch {
    return undefined;
  }
};

const defaultShellPluginDeps = (): ShellToolPluginDeps => ({
  getSettings: readHostShellSettings,
  resolveCwd: resolveShellWorkingDirectory,
});

const normalizeMcpResultForPtc = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.content)) return raw;
  const textParts = obj.content
    .filter(
      (b): b is { type: string; text: string } =>
        Boolean(b) &&
        typeof b === 'object' &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string'
    )
    .map(b => b.text);
  const text = textParts.join('\n').trim();
  let data: unknown = obj.structuredContent;
  if (data === undefined && text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON text is fine */
    }
  }
  return {
    ...obj,
    ...(text && obj.text === undefined ? { text } : {}),
    ...(data !== undefined && obj.data === undefined ? { data } : {}),
  };
};

const defaultPtcPluginDeps = (): PtcToolPluginDeps => ({
  getSettings: readHostPtcSettings,
  resolveWorkspace: async () => {
    try {
      return await resolveShellWorkingDirectory();
    } catch {
      return null;
    }
  },
  listTools: () =>
    defaultToolRegistry
      .getToolMetadata()
      .filter(tool => tool.name !== 'ptc' && tool.autoAllowed === true)
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.source ? { source: tool.source } : {}),
      })),
  invokeTool: async (toolName, args) => {
    const tool = defaultToolRegistry.get(toolName);
    if (!tool || tool.name === 'ptc' || tool.autoAllowed !== true) {
      const available = defaultToolRegistry
        .getToolMetadata()
        .filter(t => t.name !== 'ptc' && t.autoAllowed === true)
        .map(t => t.name);
      throw new Error(
        `Tool "${toolName}" is unavailable in PTC. Available tools: ${available.join(', ') || '(none)'}`
      );
    }
    const result = await tool.handler(args);
    return tool.source?.kind === 'mcp' ? normalizeMcpResultForPtc(result) : result;
  },
  listMcpServers: () => activePtcMcpBridge?.listMcpServers() ?? [],
  invokeMcpTool: async (serverRef, toolRef, args) => {
    if (!activePtcMcpBridge) {
      throw new Error(`No MCP servers connected (cannot call mcp.${serverRef}.${toolRef}).`);
    }
    const result = await activePtcMcpBridge.invokeMcpTool(serverRef, toolRef, args);
    return normalizeMcpResultForPtc(result);
  },
});

export const getBuiltinToolNames = (): readonly string[] => {
  const shellNames = createShellTools(defaultShellPluginDeps()).map(tool => tool.name);
  const ptcCfg = readHostPtcSettings();
  const ptcNames =
    ptcCfg?.enabled === false ? [] : createPtcTools(defaultPtcPluginDeps()).map(tool => tool.name);
  return [...shellNames, ...ptcNames];
};

export function registerStandardTools(overrides?: ShellToolPluginDeps) {
  registerShellTools(defaultToolRegistry, {
    ...defaultShellPluginDeps(),
    ...overrides,
  });
  registerPtcTools(defaultToolRegistry, defaultPtcPluginDeps());
}

export function registerSwarmTool(runtime: SwarmRuntimePort | (() => SwarmRuntimePort | null)) {
  const getRuntime = typeof runtime === 'function' ? runtime : () => runtime;
  return registerSwarmToolsPlugin(defaultToolRegistry, { getRuntime });
}
