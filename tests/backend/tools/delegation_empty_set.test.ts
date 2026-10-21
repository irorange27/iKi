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
    const error = await delegate('askRisky');
    expect(error?.message ?? '').not.toContain('No tool is delegable');
  });

  it('still refuses when every candidate genuinely declares approval', async () => {
    const error = await delegate('askRisky', ['write_file']);
    expect(error?.message).toContain('No tool is delegable to the subagent');
    expect(error?.message).toContain('approval-free for this subagent type');
  });

  it('leaves a turn that exposes NO tools alone', async () => {
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
    const error = await delegate(undefined);
    expect(error?.message ?? '').not.toContain('No tool is delegable');
  });
});
