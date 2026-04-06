export * from './base';
export * from './file_tools';
export * from './shell_tools';
export * from './agent_tools';
export * from './skill_tools';
export * from './web_tools';
export * from './schemas';
export * from './task_plan_tools';
export * from './todo_tools';

import { defaultToolRegistry } from './base';
import { DelegatedAgentTool } from './agent_tools';
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirTool,
  DeleteFileTool,
} from './file_tools';
import { ShellExecutionTool } from './shell_tools';
import {
  DeletePersonalSkillTool,
  ListPersonalSkillsTool,
  ReadPersonalSkillTool,
  WritePersonalSkillTool,
} from './skill_tools';
import {
  DeleteTodoListTool,
  ListTodoListsTool,
  ReadTodoListTool,
  WriteTodoListTool,
} from './todo_tools';
import { TodoTool } from './task_plan_tools';
import { WebSearchTool, FetchTool } from './web_tools';

/**
 * Register all standard system tools to the default global registry
 */
export function registerStandardTools() {
  defaultToolRegistry.register(new ListDirTool());
  defaultToolRegistry.register(new ReadFileTool());
  defaultToolRegistry.register(new EditFileTool());
  defaultToolRegistry.register(new WriteFileTool());
  defaultToolRegistry.register(new DeleteFileTool());
  defaultToolRegistry.register(new ShellExecutionTool());
  defaultToolRegistry.register(new DelegatedAgentTool());
  defaultToolRegistry.register(new WebSearchTool());
  defaultToolRegistry.register(new FetchTool());
  defaultToolRegistry.register(new ListPersonalSkillsTool());
  defaultToolRegistry.register(new ReadPersonalSkillTool());
  defaultToolRegistry.register(new WritePersonalSkillTool());
  defaultToolRegistry.register(new DeletePersonalSkillTool());
  defaultToolRegistry.register(new TodoTool());
  defaultToolRegistry.register(new ListTodoListsTool());
  defaultToolRegistry.register(new ReadTodoListTool());
  defaultToolRegistry.register(new WriteTodoListTool());
  defaultToolRegistry.register(new DeleteTodoListTool());
}
