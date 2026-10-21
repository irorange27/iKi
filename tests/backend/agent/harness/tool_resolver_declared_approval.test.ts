import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTool, defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { resolveTools } from '@iki/backend/agent/harness/tool_resolver';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startPiTurnHarness,
  },
});

const needsApprovalFor = async (
  guardActive: boolean,
  requireApproval: boolean,
  name: string
): Promise<boolean | undefined> => {
  const tools = resolveTools({
    enableTools: true,
    enabledToolNames: ['write_file', 'read_file', 'delete_file'],
    availableSkillIds: [],
    guardActive,
    requireApproval,
    autoApproveToolRequests: false,
  });
  return evaluate(tools.find(t => t.name === name));
};

const evaluate = async (tool: { needsApproval?: unknown } | undefined): Promise<boolean | undefined> => {
  if (!tool) return undefined;
  const value = tool.needsApproval;
  if (typeof value === 'function') {
    return Boolean(await (value as (input: unknown) => boolean | Promise<boolean>)({}));
  }
  return value as boolean | undefined;
};

describe("resolveTools honours a tool's declared approval requirement", () => {
  it('does not auto-approve file writes merely because the guard is inactive', async () => {
    expect(await needsApprovalFor(false, false, 'write_file')).toBe(true);
    expect(await needsApprovalFor(false, false, 'delete_file')).toBe(true);
  });

  it('leaves tools that do NOT declare approval auto-approved', async () => {
    expect(await needsApprovalFor(false, false, 'read_file')).toBe(false);
  });

  it('does not clear a tool that declares a FUNCTION-valued needsApproval', async () => {
    const probeName = 'zz_fn_approval_probe';
    defaultToolRegistry.register(
      createTool({
        name: probeName,
        type: 'function',
        description: 'probe',
        paramSchema: z.object({}),
        needsApproval: () => true,
        handler: async () => 'ok',
      })
    );
    try {
      const tools = resolveTools({
        enableTools: true,
        enabledToolNames: [probeName],
        availableSkillIds: [],
        guardActive: false,
        requireApproval: false,
        autoApproveToolRequests: false,
      });
      const resolved = tools.find(t => t.name === probeName);
      expect(resolved).toBeDefined();
      expect(await evaluate(resolved)).toBe(true);
    } finally {
      defaultToolRegistry.remove(probeName);
    }
  });

  it('preserves declared approval for EVERY tool in the window, not just writes', async () => {
    const declaring = defaultToolRegistry
      .getAll()
      .filter(t => t.needsApproval === true && t.approvalMode !== 'always')
      .map(t => t.name)
      .sort();
    expect(declaring).toEqual([
      'delete_file',
      'delete_todo_list',
      'edit',
      'undo_edit',
      'write_file',
      'write_todo_list',
    ]);

    const tools = resolveTools({
      enableTools: true,
      enabledToolNames: declaring,
      availableSkillIds: [],
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
    });
    const decisions = await Promise.all(tools.map(t => evaluate(t)));
    expect(
      tools.map((t, index) => `${t.name}:${String(decisions[index])}`).sort()
    ).toEqual(declaring.map(name => `${name}:true`));
  });

  it('still requires approval for writes when the guard is active', async () => {
    expect(await needsApprovalFor(true, true, 'write_file')).toBe(true);
  });
});
