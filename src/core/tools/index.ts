export * from './base';
export * from './file_tools';
export * from './shell_tools';

import { defaultToolRegistry } from './base';
import { ReadFileTool, WriteFileTool, ListDirTool, DeleteFileTool } from './file_tools';
import { ShellExecutionTool } from './shell_tools';

/**
 * Register all standard system tools to the default global registry
 */
export function registerStandardTools() {
  defaultToolRegistry.register(new ReadFileTool());
  defaultToolRegistry.register(new WriteFileTool());
  defaultToolRegistry.register(new ListDirTool());
  defaultToolRegistry.register(new DeleteFileTool());
  defaultToolRegistry.register(new ShellExecutionTool());
}
