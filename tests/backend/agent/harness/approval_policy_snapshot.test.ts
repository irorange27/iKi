import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
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
    createHarness: startPiTurnHarness,
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
  tools.find(tool => tool.name === name)!.needsApproval as (
    input: unknown
  ) => boolean | Promise<boolean>;

describe('approval policy snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('honours a policy change from the next step onward', async () => {
    const box = createApprovalPolicyBox('never');
    const tools = resolveWithBox(box);
    const writeNeed = need(tools, 'write_file');

    expect(await writeNeed({ path: 'a.txt' })).toBe(false);

    advanceApprovalPolicySnapshot(box, 'always');
    expect(await writeNeed({ path: 'a.txt' })).toBe(true);
  });

  it('does not let a learned allow rule reach the decision any more', async () => {
    const box = createApprovalPolicyBox('askRisky');
    const tools = resolveWithBox(box);
    const writeNeed = need(tools, 'write_file');

    expect(await writeNeed({ path: 'allowed.txt' })).toBe(true);

    advanceApprovalPolicySnapshot(box, 'askRisky');
    expect(await writeNeed({ path: 'allowed.txt' })).toBe(true);
  });

  it('keeps the legacy flags deciding when no explicit policy is set', async () => {
    const box = createApprovalPolicyBox(undefined);
    const tools = resolveTools({
      enableTools: true,
      enabledToolNames: ['write_file', 'read_file'],
      availableSkillIds: [],
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
      approvalPolicyBox: box,
    });

    expect(await need(tools, 'read_file')({ path: 'a.txt' })).toBe(false);
    expect(await need(tools, 'write_file')({ path: 'a.txt' })).toBe(true);
  });
});
