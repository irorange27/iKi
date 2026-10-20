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
  /**
   * Only the desktop shell can probe a renderer window. A standalone daemon
   * passes nothing and `element_source` then answers "no window reachable"
   * instead of failing the whole registration. Omitting it must not *clear* a
   * resolver installed earlier in the same process — the desktop app runs the
   * daemon embedded, over the same registry, after main wired the probe.
   * Pass `setElementSourceResolver(null)` to deliberately remove one.
   */
  elementSourceResolver?: ElementSourceResolver;
};

// Construct only during explicit registration so importing the barrel never
// mutates the global registry as a module-load side effect.
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

/** Canonical names of the built-in tool set, in registration order. */
export const getBuiltinToolNames = (): readonly string[] =>
  getStandardTools().map(tool => tool.name);

/**
 * Register all standard system tools to the default global registry
 */
export function registerStandardTools({
  delegatedAgentRuntime,
  elementSourceResolver,
}: StandardToolRegistrationOptions) {
  setDelegatedAgentRuntime(delegatedAgentRuntime);
  // Only install a resolver when the caller has one. An omitted resolver must
  // not clear a previously installed one: the registry and the resolver are
  // process-wide singletons, and the desktop main process starts the daemon
  // *embedded* (`services/daemon/daemon_lifecycle.ts`), so the daemon's
  // re-registration runs after main already wired the renderer probe. Clearing
  // here made `element_source` answer "no window reachable" in the desktop app.
  if (elementSourceResolver) setElementSourceResolver(elementSourceResolver);
  for (const tool of getStandardTools()) {
    defaultToolRegistry.register(tool);
  }
}
