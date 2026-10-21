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

/**
 * Evaluate the tool's answer for one call.
 *
 * The resolver publishes `needsApproval` as a PREDICATE, not a boolean: the
 * decision may await a function-valued declaration and it reads the per-step
 * policy snapshot. Asserting on the field's identity (`typeof`, `String(t.n)`)
 * stopped measuring the decision at all once the shape changed — these cases
 * now evaluate it.
 */
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
    // Identical user configuration; only the affect-derived guard differs.
    // write_file/delete_file declare needsApproval = true, so an inactive
    // guard must not turn that into an automatic approval.
    expect(await needsApprovalFor(false, false, 'write_file')).toBe(true);
    expect(await needsApprovalFor(false, false, 'delete_file')).toBe(true);
  });

  it('leaves tools that do NOT declare approval auto-approved', async () => {
    // read_file declares needsApproval = false — an inactive guard must not
    // start demanding approval for it either. The fix must be neutral here.
    expect(await needsApprovalFor(false, false, 'read_file')).toBe(false);
  });

  it('does not clear a tool that declares a FUNCTION-valued needsApproval', async () => {
    // The predicate must mirror isApprovalFreeTool (tools/agent_tools.ts): only
    // an explicit false/undefined is approval-free. A `!== true` test would
    // classify a ToolApprovalFunction as free and clear it, silently
    // discarding the tool's own answer. This registers a REAL tool through the
    // live registry and resolves it, so it fails if the predicate regresses to
    // the weak form — the earlier version of this case asserted on a local
    // copy of the predicate and could not detect its own removal.
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
      // A function declaration computes its own answer (it returns true here),
      // so the resolved decision is `ask` — not approval-free.
      expect(await evaluate(resolved)).toBe(true);
    } finally {
      defaultToolRegistry.remove(probeName);
    }
  });

  it('preserves declared approval for EVERY tool in the window, not just writes', async () => {
    // The window is no-policy + guard-inactive + no-requireApproval. Six tools
    // declare `needsApproval = true` without `approvalMode: 'always'` — the
    // four file tools AND two todo tools. Measured against the live registry
    // rather than listed by hand, so a newly added declaring tool is covered.
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
    // Every one keeps its requirement through the resolver.
    const decisions = await Promise.all(tools.map(t => evaluate(t)));
    expect(
      tools.map((t, index) => `${t.name}:${String(decisions[index])}`).sort()
    ).toEqual(declaring.map(name => `${name}:true`));
  });

  it('still requires approval for writes when the guard is active', async () => {
    expect(await needsApprovalFor(true, true, 'write_file')).toBe(true);
  });
});
