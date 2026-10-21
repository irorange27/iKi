// A delegation must never silently run with no tools.
//
// `resolveDelegableTools`' no-list branch used to return an empty array when
// nothing qualified, and the caller then built the child harness with
// `enabledTools: []` + `enableTools: false` — a subagent that runs, answers
// without tooling and reports nothing. The user sees an unhelpful answer
// instead of a configuration problem (issue #170).
//
// #170 fixed the REPORTING but misdiagnosed the CAUSE: it assumed an explicit
// approval policy legitimately leaves nothing delegable. It does not. The
// resolver puts a per-call `needsApproval` FUNCTION on every tool under
// askRisky/trustWorkspace, and the old predicate read that live decision as
// "this tool needs approval" for all of them — so the delegable set emptied
// under the product's DEFAULT policy, which is why `agent` was unusable in
// normal use. Delegability is a property of the tool's own declaration
// (`declaredNeedsApproval`), not of the turn's policy, so these cases now
// delegate normally and the guard fires only when a declaration is genuinely
// approval-gated.
import { describe, expect, it } from 'vitest';

import { defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { resolveTools } from '@iki/backend/agent/harness/tool_resolver';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startPiTurnHarness,
  },
});

const delegate = async (
  approvalPolicy: 'askRisky' | 'always' | undefined,
  enabledToolNames: string[] = ['read_file', 'write_file'],
  tools?: string[]
) => {
  const resolved = resolveTools({
    enableTools: true,
    enabledToolNames,
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
      () =>
        agent.handler({ task: 'probe', ...(tools ? { tools } : {}) } as never) as Promise<unknown>
    );
  } catch (e) {
    error = e as Error;
  }
  return error;
};

describe('delegation tool selection', () => {
  it('delegates read tools under an explicit askRisky policy', async () => {
    // The regression this file now pins: under askRisky every tool carries a
    // per-call approval function, and reading that as "gated" emptied the set.
    const error = await delegate('askRisky');
    expect(error?.message ?? '').not.toContain('No tool is delegable');
  });

  it('still refuses when every candidate genuinely declares approval', async () => {
    // write_file declares needsApproval = true. Enabling only it must fire the
    // guard: this is the shape #170 wanted to report, and it must keep firing.
    const error = await delegate('askRisky', ['write_file']);
    expect(error?.message).toContain('No tool is delegable to the subagent');
    expect(error?.message).toContain('approval-free for this subagent type');
  });

  it('leaves a turn that exposes NO tools alone', async () => {
    // A tool-free delegation is legitimate (agent_tools.test.ts relies on it):
    // the guard must fire only when tools exist but none qualifies.
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

  it('does not fire when tools are delegable', async () => {
    // No policy: registry tools carry boolean needsApproval, so read_file
    // qualifies. This reaches child-harness construction, which stops without a
    // reachable provider — so assert the failure is NOT the guard.
    const error = await delegate(undefined);
    expect(error?.message ?? '').not.toContain('No tool is delegable');
  });
});
