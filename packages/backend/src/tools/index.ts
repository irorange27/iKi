export * from './base';
export * from './json_schema';
export * from './file_tools';
export * from './shell_tools';
export * from './agent_tools';
export * from './skill_tools';
export * from './web_tools';
export * from './schemas';
export * from './task_plan_tools';
export * from './todo_tools';
export * from './proactive_task_tools';
export * from './awaiter_tools';
export * from './plan_tools';
export * from './handoff_tool';

import { defaultToolRegistry } from './base';
import { DelegatedAgentTool } from './agent_tools';
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  UndoEditTool,
  DeleteFileTool,
} from './file_tools';
import { ShellExecutionTool } from './shell_tools';
import {
  DeletePersonalSkillTool,
  ListPersonalSkillsTool,
  LoadSkillTool,
  ReadPersonalSkillTool,
  WritePersonalSkillTool,
} from './skill_tools';
import {
  DeleteTodoListTool,
  ListTodoListsTool,
  ReadTodoListTool,
  WriteTodoListTool,
} from './todo_tools';
import {
  DeleteProactiveTaskTool,
  ListProactiveTasksTool,
  ReadProactiveTaskTool,
  WriteProactiveTaskTool,
} from './proactive_task_tools';
import {
  DeleteAwaiterTool,
  ListAwaitersTool,
  ReadAwaiterTool,
  WriteAwaiterTool,
} from './awaiter_tools';
import { PlanTool } from './plan_tools';
import { TodoTool } from './task_plan_tools';
import { WebSearchTool, FetchTool } from './web_tools';
import { HandoffTool } from './handoff_tool';

/**
 * Register all standard system tools to the default global registry
 */
export function registerStandardTools() {
  defaultToolRegistry.register(new ReadFileTool());
  defaultToolRegistry.register(new EditFileTool());
  defaultToolRegistry.register(new UndoEditTool());
  defaultToolRegistry.register(new WriteFileTool());
  defaultToolRegistry.register(new DeleteFileTool());
  defaultToolRegistry.register(new ShellExecutionTool());
  defaultToolRegistry.register(new DelegatedAgentTool());
  defaultToolRegistry.register(new WebSearchTool());
  defaultToolRegistry.register(new FetchTool());
  defaultToolRegistry.register(new ListPersonalSkillsTool());
  defaultToolRegistry.register(new ReadPersonalSkillTool());
  defaultToolRegistry.register(new LoadSkillTool());
  defaultToolRegistry.register(new WritePersonalSkillTool());
  defaultToolRegistry.register(new DeletePersonalSkillTool());
  defaultToolRegistry.register(new PlanTool());
  defaultToolRegistry.register(new TodoTool());
  defaultToolRegistry.register(new ListTodoListsTool());
  defaultToolRegistry.register(new ReadTodoListTool());
  defaultToolRegistry.register(new WriteTodoListTool());
  defaultToolRegistry.register(new DeleteTodoListTool());
  defaultToolRegistry.register(new ListProactiveTasksTool());
  defaultToolRegistry.register(new ReadProactiveTaskTool());
  defaultToolRegistry.register(new WriteProactiveTaskTool());
  defaultToolRegistry.register(new DeleteProactiveTaskTool());
  defaultToolRegistry.register(new ListAwaitersTool());
  defaultToolRegistry.register(new ReadAwaiterTool());
  defaultToolRegistry.register(new WriteAwaiterTool());
  defaultToolRegistry.register(new DeleteAwaiterTool());
  defaultToolRegistry.register(new HandoffTool());
}
