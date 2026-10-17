// A delegation that cannot supply any tool must say so.
//
// `resolveDelegableTools`' no-list branch used to return an empty array when
// nothing qualified, and the caller then built the child harness with
// `enabledTools: []` + `enableTools: false` — a subagent that runs, answers
// without tooling and reports nothing. The user sees an unhelpful answer
// instead of a configuration problem (issue #170).
//
// The likeliest trigger is an explicit approval policy: the resolver then
// puts a per-call `needsApproval` FUNCTION on every tool
// (tool_resolver.ts), and `isApprovalFreeTool` cannot prove a function safe
// without an input, so the delegable set is empty.
import { describe, expect, it } from 'vitest';

import { defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { resolveTools } from '@iki/backend/agent/harness/tool_resolver';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startTurnHarness,
  },
});

const delegate = async (approvalPolicy: 'askRisky' | undefined, tools?: string[]) => {
  const resolved = resolveTools({
    enableTools: true,
    enabledToolNames: ['read_file', 'write_file'],
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    ...(approvalPolicy ? { approvalPolicy } : {}),
  });
  const agent = defaultToolRegistry.get('agent')!;
  let error: Error | undefined;
  try {
    await runWithToolRuntimeContext(
      {
        threadId: 'thread_delegation',
        availableTools: resolved,
        conversationModel: { providerType: 'openai', model: 'probe-model' },
      } as never,
      () => agent.handler({ task: 'probe', ...(tools ? { tools } : {}) } as never) as Promise<unknown>
    );
  } catch (e) {
    error = e as Error;
  }
  return error;
};

describe('a delegation with no usable tool fails loudly', () => {
  it('refuses when an approval policy makes every tool non-delegable', async () => {
    const error = await delegate('askRisky');
    expect(error?.message).toContain('No tool is delegable to the subagent');
    // The message must point at the real cause, not just say "failed".
    expect(error?.message).toContain('per-call approval');
  });

  it('leaves a turn that exposes NO tools alone', async () => {
    // A tool-free delegation is legitimate (agent_tools.test.ts:313 relies on
    // it): the guard must fire only when tools exist but none qualifies.
    const agent = defaultToolRegistry.get('agent')!;
    let error: Error | undefined;
    try {
      await runWithToolRuntimeContext(
        {
          threadId: 'thread_no_tools',
          availableTools: [],
          conversationModel: { providerType: 'openai', model: 'probe-model' },
        } as never,
        () => agent.handler({ task: 'probe' } as never) as Promise<unknown>
      );
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message ?? '').not.toContain('No tool is delegable');
  });

  it('still delegates normally when tools are delegable', async () => {
    // The guard must not fire on the ordinary path. No policy: registry tools
    // carry boolean needsApproval, so read_file qualifies and write_file does
    // not. This reaches the child-harness construction, which is where it
    // stops without a reachable provider — so assert the failure is NOT the
    // new guard.
    const error = await delegate(undefined);
    expect(error?.message ?? '').not.toContain('No tool is delegable');
  });
});
