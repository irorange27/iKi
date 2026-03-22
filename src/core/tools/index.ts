export * from './base';
export * from './file_tools';
export * from './shell_tools';
export * from './skill_tools';
export * from './web_tools';
export * from './schemas';
export * from './todo_tools';

import { defaultToolRegistry } from './base';
import { ReadFileTool, WriteFileTool, ListDirTool, DeleteFileTool } from './file_tools';
import { ShellExecutionTool } from './shell_tools';
import {
  DeleteTodoListTool,
  ListTodoListsTool,
  ReadTodoListTool,
  WriteTodoListTool,
} from './todo_tools';
import { WebSearchTool, FetchTool } from './web_tools';

/**
 * Register all standard system tools to the default global registry
 */
export function registerStandardTools() {
  defaultToolRegistry.register(new ReadFileTool());
  defaultToolRegistry.register(new WriteFileTool());
  defaultToolRegistry.register(new ListDirTool());
  defaultToolRegistry.register(new DeleteFileTool());
  defaultToolRegistry.register(new ShellExecutionTool());
  defaultToolRegistry.register(new WebSearchTool());
  defaultToolRegistry.register(new FetchTool());
  defaultToolRegistry.register(new ListTodoListsTool());
  defaultToolRegistry.register(new ReadTodoListTool());
  defaultToolRegistry.register(new WriteTodoListTool());
  defaultToolRegistry.register(new DeleteTodoListTool());
}
