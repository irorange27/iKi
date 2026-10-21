export * from './base';
export * from './json_schema';
export * from './file_tools';
export * from './shell_tools';
export * from './agent_tools';
export * from './skill_tools';
export * from './web_tools';
export * from './element_source_tool';
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
import { ElementSourceTool, setElementSourceResolver, type ElementSourceResolver } from './element_source_tool';
import { HandoffTool } from './handoff_tool';

export type StandardToolRegistrationOptions = {
  delegatedAgentRuntime: DelegatedAgentRuntime;

  elementSourceResolver?: ElementSourceResolver;
};

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
  new ElementSourceTool(),
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

export const getBuiltinToolNames = (): readonly string[] =>
  getStandardTools().map(tool => tool.name);

export function registerStandardTools({
  delegatedAgentRuntime,
  elementSourceResolver,
}: StandardToolRegistrationOptions) {
  setDelegatedAgentRuntime(delegatedAgentRuntime);

  if (elementSourceResolver) setElementSourceResolver(elementSourceResolver);
  for (const tool of getStandardTools()) {
    defaultToolRegistry.register(tool);
  }
}
