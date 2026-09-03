import { describe, expect, it } from 'vitest';

import { registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/agent_session/run_tracker';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { resolveTools } from '@iki/backend/agent/harness/tool_resolver';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
  },
});

const resolve = (
  approvalPolicy?: 'never' | 'trustWorkspace' | 'askRisky' | 'always',
  toolNames = ['write_file', 'read_file', 'edit']
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

const needsApproval = (tools: ReturnType<typeof resolve>, name: string): boolean | undefined =>
  tools.find(t => t.name === name)?.needsApproval;

describe('resolveTools approvalPolicy (ADR 005)', () => {
  it('never clears approval on every tool', () => {
    const tools = resolve('never');
    expect(needsApproval(tools, 'write_file')).toBe(false);
    expect(needsApproval(tools, 'edit')).toBe(false);
  });

  it('always gates every tool', () => {
    const tools = resolve('always');
    expect(needsApproval(tools, 'write_file')).toBe(true);
    expect(needsApproval(tools, 'read_file')).toBe(true);
  });

  it('trustWorkspace auto-approves workspace writes and readonly shell, escalates the rest', () => {
    const tools = resolve('trustWorkspace', ['write_file', 'read_file', 'edit', 'shell', 'delete_file']);

    const writeNeed = needsApproval(tools, 'write_file');
    expect(typeof writeNeed).toBe('function');
    expect((writeNeed as (input: unknown) => boolean)({ path: 'a.txt' })).toBe(false);

    const shellNeed = needsApproval(tools, 'shell') as (input: unknown) => boolean;
    expect(shellNeed({ command: 'ls -la' })).toBe(false);
    expect(shellNeed({ command: 'rm -rf build' })).toBe(true);

    expect((needsApproval(tools, 'delete_file') as (input: unknown) => boolean)({})).toBe(true);
  });

  it('defaults to the legacy guard behavior when no policy is set', () => {
    const tools = resolve(undefined);
    expect(needsApproval(tools, 'read_file')).toBe(false);
    // write_file's own registry flag is false — legacy default leaves it alone
    expect(needsApproval(tools, 'write_file')).toBe(false);
  });
});
