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

const needsApproval = async (
  tools: ReturnType<typeof resolve>,
  name: string,
  input: unknown = {}
): Promise<boolean | undefined> => {
  const tool = tools.find(t => t.name === name);
  if (!tool) return undefined;
  const value = tool.needsApproval;
  if (typeof value === 'function') {
    return await (value as (input: unknown) => Promise<boolean>)(input);
  }
  return value;
};

describe('resolveTools approvalPolicy (ADR 005)', () => {
  it('never clears approval on every tool', async () => {
    const tools = resolve('never');
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

    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(false);
    expect(await needsApproval(tools, 'edit', { path: 'a.txt' })).toBe(false);

    expect(await needsApproval(tools, 'shell', { command: 'ls -la' })).toBe(true);
    expect(await needsApproval(tools, 'shell', { command: 'rm -rf build' })).toBe(true);

    expect(await needsApproval(tools, 'delete_file', { path: 'a.txt' })).toBe(true);
  });

  it('askRisky gates writes and unknown tools while allowing known reads', async () => {
    const tools = resolve('askRisky');
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(true);
    expect(await needsApproval(tools, 'undo_edit', { path: 'a.txt' })).toBe(true);
    expect(await needsApproval(tools, 'read_file', { path: 'a.txt' })).toBe(false);
  });

  it('defaults to the legacy guard behavior when no policy is set', async () => {
    const tools = resolve(undefined);
    expect(await needsApproval(tools, 'read_file', { path: 'a.txt' })).toBe(false);
    expect(await needsApproval(tools, 'write_file', { path: 'a.txt' })).toBe(true);
  });
});
