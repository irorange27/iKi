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
import {
  DelegatedAgentTool,
  setDelegatedAgentRuntime,
  type DelegatedAgentRuntime,
} from './agent_tools';
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

export type StandardToolRegistrationOptions = {
  delegatedAgentRuntime: DelegatedAgentRuntime;
};

// Lazy: tools/index sits in an import cycle (agent_tools -> agent/harness ->
// tool_resolver -> tools barrel), so tool instances must not be constructed at
// module-load time — only after evaluation of every module in the cycle.
const buildStandardTools = () => [
  new ReadFileTool(),
  new EditFileTool(),
  new UndoEditTool(),
  new WriteFileTool(),
  new DeleteFileTool(),
  new ShellExecutionTool(),
  new DelegatedAgentTool(),
  new WebSearchTool(),
  new FetchTool(),
  new ListPersonalSkillsTool(),
  new ReadPersonalSkillTool(),
  new LoadSkillTool(),
  new WritePersonalSkillTool(),
  new DeletePersonalSkillTool(),
  new PlanTool(),
  new TodoTool(),
  new ListTodoListsTool(),
  new ReadTodoListTool(),
  new WriteTodoListTool(),
  new DeleteTodoListTool(),
  new ListProactiveTasksTool(),
  new ReadProactiveTaskTool(),
  new WriteProactiveTaskTool(),
  new DeleteProactiveTaskTool(),
  new ListAwaitersTool(),
  new ReadAwaiterTool(),
  new WriteAwaiterTool(),
  new DeleteAwaiterTool(),
  new HandoffTool(),
];

let standardTools: ReturnType<typeof buildStandardTools> | null = null;

const getStandardTools = () => (standardTools ??= buildStandardTools());

/** Canonical names of the built-in tool set, in registration order. */
export const getBuiltinToolNames = (): readonly string[] =>
  getStandardTools().map(tool => tool.name);

/**
 * Register all standard system tools to the default global registry
 */
export function registerStandardTools({
  delegatedAgentRuntime,
}: StandardToolRegistrationOptions) {
  setDelegatedAgentRuntime(delegatedAgentRuntime);
  for (const tool of getStandardTools()) {
    defaultToolRegistry.register(tool);
  }
}
