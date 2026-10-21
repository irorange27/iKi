
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

const TABLE: ReadonlyArray<[tool: BaseTool, replay: 'safe' | 'unsafe', why: string]> = [
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

  [new WriteFileTool(), 'unsafe', 'writes a file'],
  [new EditFileTool(), 'unsafe', 'fuzzy-match replacement, applies twice'],
  [new UndoEditTool(), 'unsafe', 'would revert a second, different edit'],
  [new DeleteFileTool(), 'unsafe', 'deletes a file'],
  [new ShellExecutionTool(), 'unsafe', 'arbitrary commands'],
  [new DelegatedAgentTool(), 'unsafe', 'runs a whole child turn'],
  [new WritePersonalSkillTool(), 'unsafe', 'writes a row'],
  [new DeletePersonalSkillTool(), 'unsafe', 'deletes a row'],
  [new WriteProactiveTaskTool(), 'unsafe', 'writes a row'],
  [new DeleteProactiveTaskTool(), 'unsafe', 'deletes a row'],
  [new WriteAwaiterTool(), 'unsafe', 'writes a row'],
  [new DeleteAwaiterTool(), 'unsafe', 'deletes a row'],
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
    const declared = new Set(TABLE.map(([tool]) => tool.name));
    const undeclared = getBuiltinToolNames().filter(name => !declared.has(name));
    expect(undeclared).toEqual([]);
  });

  it('defaults to unsafe: an undeclared tool carries no permission to rerun', () => {
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
    expect(Object.hasOwn(bare.toAgentTool(), 'replay')).toBe(false);
  });
});
