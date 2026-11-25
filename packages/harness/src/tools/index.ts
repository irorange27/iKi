export * from './base';
export * from '@iki/tools/shell';
export * from '@iki/tools/swarm';

import { getAppConfig } from '@iki/harness/config';
import { createShellTools, registerShellTools, type ShellToolPluginDeps } from '@iki/tools/shell';
import { registerSwarmTools as registerSwarmToolsPlugin, type SwarmRuntimePort } from '@iki/tools/swarm';
import { defaultToolRegistry } from './base';
import { resolveShellWorkingDirectory } from './workspace_paths';

const readHostShellSettings = () => {
  try {
    return getAppConfig().tools.shell;
  } catch {
    return undefined;
  }
};

const defaultShellPluginDeps = (): ShellToolPluginDeps => ({
  getSettings: readHostShellSettings,
  resolveCwd: resolveShellWorkingDirectory,
});

export const getBuiltinToolNames = (): readonly string[] =>
  createShellTools(defaultShellPluginDeps()).map(tool => tool.name);

export function registerStandardTools(overrides?: ShellToolPluginDeps) {
  registerShellTools(defaultToolRegistry, {
    ...defaultShellPluginDeps(),
    ...overrides,
  });
}

export function registerSwarmTool(runtime: SwarmRuntimePort | (() => SwarmRuntimePort | null)) {
  const getRuntime = typeof runtime === 'function' ? runtime : () => runtime;
  return registerSwarmToolsPlugin(defaultToolRegistry, { getRuntime });
}
