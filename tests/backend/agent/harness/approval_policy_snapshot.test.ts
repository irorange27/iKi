import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listToolAllowPatternsMock } = vi.hoisted(() => ({
  listToolAllowPatternsMock: vi.fn((): string[] => []),
}));

vi.mock('@iki/backend/db/tool_allowlist', () => ({
  listToolAllowPatterns: listToolAllowPatternsMock,
}));

import { registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/turn_prep/run_tracker';
import { getToolModel } from '@iki/backend/provider/tool_model';
import type { AgentTool } from '@iki/backend/agent/types';
import {
  advanceApprovalPolicySnapshot,
  createApprovalPolicyBox,
  resolveTools,
  type ApprovalPolicyBox,
} from '@iki/backend/agent/harness/tool_resolver';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
  },
});

const resolveWithBox = (box: ApprovalPolicyBox): AgentTool[] =>
  resolveTools({
    enableTools: true,
    enabledToolNames: ['write_file', 'shell'],
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    approvalPolicy: box.policy,
    approvalPolicyBox: box,
  });

const need = (tools: AgentTool[], name: string) =>
  tools.find(tool => tool.name === name)!.needsApproval as (input: unknown) => boolean;

// Per-step semantics: one SDK step's tool calls share a policy snapshot, and a
// user change lands on the next step (see agent_harness onModelStep).
describe('approval policy snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listToolAllowPatternsMock.mockReturnValue([]);
  });

  it('shares one allowlist read across the tool calls of a step', () => {
    listToolAllowPatternsMock.mockReturnValue(['{"path":"allowed.txt"}']);
    const box = createApprovalPolicyBox('askRisky');
    const tools = resolveWithBox(box);
    const writeNeed = need(tools, 'write_file');

    writeNeed({ path: 'allowed.txt' });
    writeNeed({ path: 'other.txt' });
    expect(listToolAllowPatternsMock).toHaveBeenCalledTimes(1);

    advanceApprovalPolicySnapshot(box, 'askRisky');
    writeNeed({ path: 'allowed.txt' });
    expect(listToolAllowPatternsMock).toHaveBeenCalledTimes(2);
  });

  it('honours a policy change from the next step onward', () => {
    const box = createApprovalPolicyBox('never');
    const tools = resolveWithBox(box);
    const writeNeed = need(tools, 'write_file');

    expect(writeNeed({ path: 'a.txt' })).toBe(false);

    advanceApprovalPolicySnapshot(box, 'always');
    expect(writeNeed({ path: 'a.txt' })).toBe(true);
  });

  it('applies a learned allow rule once the snapshot advances', () => {
    const box = createApprovalPolicyBox('askRisky');
    const tools = resolveWithBox(box);
    const writeNeed = need(tools, 'write_file');

    expect(writeNeed({ path: 'allowed.txt' })).toBe(true);

    listToolAllowPatternsMock.mockReturnValue(['{"path":"allowed.txt"}']);
    advanceApprovalPolicySnapshot(box, 'askRisky');
    expect(writeNeed({ path: 'allowed.txt' })).toBe(false);
  });

  it('keeps the legacy flags deciding when no explicit policy is set', () => {
    const box = createApprovalPolicyBox(undefined);
    const tools = resolveTools({
      enableTools: true,
      enabledToolNames: ['write_file'],
      availableSkillIds: [],
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
      approvalPolicyBox: box,
    });

    // Merely having a snapshot must not turn an unconfigured turn into
    // escalate-everything (which silently gates every tool behind an approval).
    expect(need(tools, 'write_file')({ path: 'a.txt' })).toBe(false);
  });
});
