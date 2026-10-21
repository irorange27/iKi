/**
 * The replay classification table (P3).
 *
 * Every registered tool must answer "may I be re-run after an interrupted
 * execution?" explicitly. This file is the table's lock: it fails when a tool is
 * added without a decision, and it pins the read-only/write split so a future
 * edit cannot quietly widen `safe` — which is the one mistake that turns a
 * recovery into a duplicated write.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getBuiltinToolNames } from '@iki/backend/tools';
import { BaseTool } from '@iki/backend/tools/base';
import { ReadFileTool, WriteFileTool, EditFileTool, UndoEditTool, DeleteFileTool } from '@iki/backend/tools/file_tools';
import { ShellExecutionTool } from '@iki/backend/tools/shell_tools';
import { DelegatedAgentTool } from '@iki/backend/tools/agent_tools';
import { WebSearchTool, FetchTool } from '@iki/backend/tools/web_tools';
import { ElementSourceTool } from '@iki/backend/tools/element_source_tool';
import {
  ListPersonalSkillsTool,
  LoadSkillTool,
  ReadPersonalSkillTool,
  WritePersonalSkillTool,
  DeletePersonalSkillTool,
} from '@iki/backend/tools/skill_tools';
import { PlanTool } from '@iki/backend/tools/plan_tools';
import { TodoTool } from '@iki/backend/tools/task_plan_tools';
import { HandoffTool } from '@iki/backend/tools/handoff_tool';
import {
  ListProactiveTasksTool,
  ReadProactiveTaskTool,
  WriteProactiveTaskTool,
  DeleteProactiveTaskTool,
} from '@iki/backend/tools/proactive_task_tools';
import {
  ListAwaitersTool,
  ReadAwaiterTool,
  WriteAwaiterTool,
  DeleteAwaiterTool,
} from '@iki/backend/tools/awaiter_tools';

/** The declared classification, tool by tool. A `safe` entry must be a pure read. */
const TABLE: ReadonlyArray<[tool: BaseTool, replay: 'safe' | 'unsafe', why: string]> = [
  // Pure reads: a second run observes again and does nothing else.
  [new ReadFileTool(), 'safe', 'reads a file'],
  [new WebSearchTool(), 'safe', 'outbound search, no local effect'],
  [new FetchTool(), 'safe', 'HTTP GET'],
  [new ElementSourceTool(), 'safe', 'reads the renderer component chain'],
  [new ListPersonalSkillsTool(), 'safe', 'lists rows'],
  [new ReadPersonalSkillTool(), 'safe', 'reads one row'],
  [new LoadSkillTool(), 'safe', 'loads skill text into context'],
  [new PlanTool(), 'safe', 'pure computation over its own args'],
  [new ListProactiveTasksTool(), 'safe', 'lists rows'],
  [new ReadProactiveTaskTool(), 'safe', 'reads one row'],
  [new ListAwaitersTool(), 'safe', 'lists rows'],
  [new ReadAwaiterTool(), 'safe', 'reads one row'],

  // Writes and control flow: a replay can duplicate or half-apply an effect.
  [new WriteFileTool(), 'unsafe', 'writes a file'],
  [new EditFileTool(), 'unsafe', 'fuzzy-match replacement, applies twice'],
  [new UndoEditTool(), 'unsafe', 'would revert a second, different edit'],
  [new DeleteFileTool(), 'unsafe', 'deletes a file'],
  [new ShellExecutionTool(), 'unsafe', 'arbitrary commands'],
  [new DelegatedAgentTool(), 'unsafe', 'runs a whole child turn'],
  [new WritePersonalSkillTool(), 'unsafe', 'writes a row'],
  [new DeletePersonalSkillTool(), 'unsafe', 'deletes a row'],
  [new TodoTool(), 'unsafe', 'persists the thread turn plan'],
  [new WriteProactiveTaskTool(), 'unsafe', 'writes a row'],
  [new DeleteProactiveTaskTool(), 'unsafe', 'deletes a row'],
  [new WriteAwaiterTool(), 'unsafe', 'writes a row'],
  [new DeleteAwaiterTool(), 'unsafe', 'deletes a row'],
  [new HandoffTool(), 'unsafe', 'ends the turn and starts a successor run'],
];

describe('the replay classification table', () => {
  it.each(TABLE)('$0.name is $1 because it $2', (tool, replay) => {
    expect(tool.replay).toBe(replay);
  });

  it('carries the declaration into the AgentTool the resolver sees', () => {
    for (const [tool, replay] of TABLE) {
      expect(tool.toAgentTool().replay).toBe(replay);
    }
  });

  it('leaves no registered tool undeclared', () => {
    // `getBuiltinToolNames` is the registration list; the ones absent from TABLE
    // are the modules this task does not own. Anything else missing is a tool
    // that was added without a replay decision, and silence means unsafe — the
    // assertion documents that rather than letting it pass unnoticed.
    const declared = new Set(TABLE.map(([tool]) => tool.name));
    const undeclared = getBuiltinToolNames().filter(name => !declared.has(name));
    // todo_tools' four list/read/write/delete tools are owned by the dead-code
    // pass (P5) and are being deleted; they are expected here until then.
    const ownedElsewhere = new Set([
      'list_todo_lists',
      'read_todo_list',
      'write_todo_list',
      'delete_todo_list',
    ]);
    expect(undeclared.filter(name => !ownedElsewhere.has(name))).toEqual([]);
  });

  it('defaults to unsafe: an undeclared tool carries no permission to rerun', () => {
    // The whole point of the contract. A tool that declares nothing must not
    // come out of the declaration surface looking replayable.
    const bare = new (class extends BaseTool {
      override name = 'probe_undeclared_tool';
      override type = 'function';
      override description = 'declares nothing';
      override paramSchema = z.object({});
      protected override async handler() {
        return null;
      }
    })();
    expect(bare.replay).toBeUndefined();
    // Undeclared is OMITTED, not defaulted to 'safe' at the source: the
    // fail-closed default belongs at the read (`declaredReplayPolicy`), and
    // writing 'unsafe' here would erase the difference between "declared
    // unsafe" and "never said anything".
    expect(Object.hasOwn(bare.toAgentTool(), 'replay')).toBe(false);
  });
});
