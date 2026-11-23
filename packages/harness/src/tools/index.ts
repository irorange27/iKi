export * from './base';
export * from '@iki/tools/shell';

import { getAppConfig } from '@iki/harness/config';
import { createShellTools, registerShellTools, type ShellToolPluginDeps } from '@iki/tools/shell';
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
