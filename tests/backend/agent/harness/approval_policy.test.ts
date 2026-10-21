import { describe, expect, it } from 'vitest';

import { registerStandardTools } from '@iki/backend/tools';
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

const resolve = (
  approvalPolicy?: 'never' | 'trustWorkspace' | 'askRisky' | 'always',
  toolNames = ['write_file', 'read_file', 'edit', 'undo_edit']
) =>
  resolveTools({
    enableTools: true,
    enabledToolNames: toolNames,
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    approvalPolicy,
  });

/**
 * Evaluate a tool's approval answer for one call.
 *
 * The resolver publishes `needsApproval` as a PREDICATE, not a boolean: the
 * answer depends on the call (a learned allow rule matches complete arguments,
 * and the per-step snapshot advances between model steps). A boolean could only
 * express the static case, which is why these tests used to read the field
 * directly and broke the moment the decision became per-call.
 */
const needsApproval = async (
  tools: ReturnType<typeof resolve>,
  name: string,
  input: unknown = {}
): Promise<boolean | undefined> => {
  const tool = tools.find(t => t.name === name);
  if (!tool) return undefined;
  const value = tool.needsApproval;
  if (typeof value === 'function') {
    // The predicate is ASYNC by contract: a function-valued declaration may
    // compute its answer per call, so the resolver forwards a promise. Callers
    // that compare against a boolean must await — reading the field alone is
    // how these tests silently stopped testing anything.
    return await (value as (input: unknown) => Promise<boolean>)(input);
  }
  return value;
};

describe('resolveTools approvalPolicy (ADR 005)', () => {
  it('never clears approval on every tool', async () => {
    const tools = resolve('never');
    // ADR 005 decision 1: the legal unattended dial for eval/daemon automation.
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(false);
    expect(await needsApproval(tools, 'edit', { path: 'a.txt' })).toBe(false);
  });

  it('always gates every tool', async () => {
    const tools = resolve('always');
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(true);
    expect(await needsApproval(tools, 'read_file', { path: 'a.txt' })).toBe(true);
  });

  it('trustWorkspace auto-approves workspace writes but gates all shell commands', async () => {
    const tools = resolve('trustWorkspace', [
      'write_file',
      'read_file',
      'edit',
      'shell',
      'delete_file',
    ]);

    // ADR 005 decision 2: trustWorkspace "还放行工作区写工具". The user chose
    // this dial; the composer's copy says "only ask for actions classified as
    // risky", and a workspace write is not one.
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(false);
    expect(await needsApproval(tools, 'edit', { path: 'a.txt' })).toBe(false);

    // Shell is never name-classified safe, whatever the command text says.
    expect(await needsApproval(tools, 'shell', { command: 'ls -la' })).toBe(true);
    expect(await needsApproval(tools, 'shell', { command: 'rm -rf build' })).toBe(true);

    // delete_file is NOT a workspace write (it is not on that list).
    expect(await needsApproval(tools, 'delete_file', { path: 'a.txt' })).toBe(true);
  });

  it('askRisky gates writes and unknown tools while allowing known reads', async () => {
    const tools = resolve('askRisky');
    // askRisky permits known READS only — writes are risky, so they ask.
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(true);
    expect(await needsApproval(tools, 'undo_edit', { path: 'a.txt' })).toBe(true);
    expect(await needsApproval(tools, 'read_file', { path: 'a.txt' })).toBe(false);
  });

  it('defaults to the legacy guard behavior when no policy is set', async () => {
    const tools = resolve(undefined);
    // A tool that never asked for approval stays auto-approved.
    expect(await needsApproval(tools, 'read_file', { path: 'a.txt' })).toBe(false);
    // A tool that DOES ask for approval keeps it. write_file's registry flag
    // is true (tools/file_tools.ts) — the legacy default must not discard a
    // tool's own declaration and make it less safe than it says it is (#166).
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(true);
  });
});
