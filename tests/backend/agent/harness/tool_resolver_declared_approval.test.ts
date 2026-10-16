// The resolver must not discard a tool's own `needsApproval: true`.
//
// `resolveStaticTool` ends with a branch that, whenever the affect guard is
// inactive, force-sets `needsApproval: false` on ANY tool whose
// `approvalMode` is not 'always' — including every file-write tool, which
// declares `needsApproval = true` (file_tools.ts). The resolver therefore
// made a tool LESS safe than its own declaration, and the determinant was
// affect state alone: a calm reading auto-approved writes while a distressed
// one required approval, with identical user configuration.
//
// (Audit H8 called affect an implicit privilege channel; a review proved the
// claim by measuring exactly this, and the earlier attempt to correct the
// audit was wrong.)
import { describe, expect, it } from 'vitest';

import { registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { resolveTools } from '@iki/backend/agent/harness/tool_resolver';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startTurnHarness,
  },
});

const needsApprovalFor = (guardActive: boolean, requireApproval: boolean, name: string) => {
  const tools = resolveTools({
    enableTools: true,
    enabledToolNames: ['write_file', 'read_file', 'delete_file'],
    availableSkillIds: [],
    guardActive,
    requireApproval,
    autoApproveToolRequests: false,
  });
  return tools.find(t => t.name === name)?.needsApproval;
};

describe('resolveTools honours a tool\'s declared approval requirement', () => {
  it('does not auto-approve file writes merely because the guard is inactive', () => {
    // Identical user configuration; only the affect-derived guard differs.
    // write_file/delete_file declare needsApproval = true, so an inactive
    // guard must not turn that into an automatic approval.
    expect(needsApprovalFor(false, false, 'write_file')).toBe(true);
    expect(needsApprovalFor(false, false, 'delete_file')).toBe(true);
  });

  it('leaves tools that do NOT declare approval auto-approved', () => {
    // read_file declares needsApproval = false — an inactive guard must not
    // start demanding approval for it either. The fix must be neutral here.
    expect(needsApprovalFor(false, false, 'read_file')).toBe(false);
  });

  it('treats only an explicit false/undefined declaration as approval-free', () => {
    // `AgentTool.needsApproval` is `boolean | ToolApprovalFunction`
    // (agent/types.ts:70). A predicate of `!== true` would classify a FUNCTION
    // as approval-free and clear it, so the branch mirrors the existing
    // isApprovalFreeTool (tools/agent_tools.ts:113-115): free means an
    // explicit false or undefined, nothing else.
    const isApprovalFree = (needsApproval: unknown) =>
      needsApproval === false || needsApproval === undefined;

    expect(isApprovalFree(true)).toBe(false);
    expect(isApprovalFree(() => true)).toBe(false);
    expect(isApprovalFree(false)).toBe(true);
    expect(isApprovalFree(undefined)).toBe(true);

    // And the live write tool is NOT classified free.
    const tools = resolveTools({
      enableTools: true,
      enabledToolNames: ['write_file'],
      availableSkillIds: [],
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
    });
    expect(tools.find(t => t.name === 'write_file')?.needsApproval).toBe(true);
  });

  it('still requires approval for writes when the guard is active', () => {
    expect(needsApprovalFor(true, true, 'write_file')).toBe(true);
  });
});
