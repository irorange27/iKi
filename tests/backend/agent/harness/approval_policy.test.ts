import { describe, expect, it } from 'vitest';

import { registerStandardTools } from '@iki/backend/tools';
import { resolveTools } from '@iki/backend/agent/harness/tool_resolver';

registerStandardTools();

const resolve = (approvalPolicy?: 'never' | 'trustWorkspace' | 'askRisky' | 'always') =>
  resolveTools({
    enableTools: true,
    enabledToolNames: ['write_file', 'read_file', 'edit'],
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

  it('defaults to the legacy guard behavior when no policy is set', () => {
    const tools = resolve(undefined);
    expect(needsApproval(tools, 'read_file')).toBe(false);
    // write_file's own registry flag is false — legacy default leaves it alone
    expect(needsApproval(tools, 'write_file')).toBe(false);
  });
});
