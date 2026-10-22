import { describe, expect, it, vi } from 'vitest';

import { createTurnDriver } from '@iki/backend/thread_session/turn_driver';
import type { TurnDriverDeps } from '@iki/backend/thread_session/turn_driver';
import type { AgentStep } from '@iki/backend/agent/agent_step';
import type { TurnDriverHarness } from '@iki/backend/agent/harness';

const toolStart = (): AgentStep =>
  ({
    type: 'tool_execution_start',
    toolCallId: 'call_1',
    toolName: 'shell',
    input: { command: 'sleep 60' },
  }) as AgentStep;

const toolEnd = (): AgentStep =>
  ({
    type: 'tool_execution_end',
    toolCallId: 'call_1',
    outcome: 'success',
    output: 'done',
  }) as AgentStep;

const harnessFor = (steps: AgentStep[]): TurnDriverHarness => ({
  async *turn() {
    for (const step of steps) yield { event: 'step' as const, step };
    yield { event: 'done' as const, output: {} as never };
  },
  getHistory: () => [],
});

const driveTurn = async (steps: AgentStep[], onToolActivity: () => void) => {
  const deps = {
    target: { id: 1, send: vi.fn() },
    plan: {
      threadId: 'thread_1',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      budget: { step: 5 },
    },
    streamState: { cancelled: false, abortController: new AbortController() },
    uiChunkEmitter: {
      messageId: 'assistant_1',
      emitToolEvent: vi.fn(),
      emitTextDelta: vi.fn(),
      settleParts: vi.fn(),
      buildPersistedMessage: vi.fn(async () => null),
      finish: vi.fn(),
      abort: vi.fn(),
      error: vi.fn(),
    },
    notifyRunStatus: vi.fn(),
    drainSteerMessages: () => [],
    onToolActivity,
    approvals: { ensurePendingApprovalSession: vi.fn(), registerApprovalBatch: vi.fn() },
  } as unknown as TurnDriverDeps;

  const driver = createTurnDriver(
    {
      harness: harnessFor(steps),
      runTracker: { id: 'run_1', recordAgentStep: vi.fn() } as never,
      streamHistory: [],
      streamPrompt: 'go',
    },
    deps
  );
  await driver.run().catch(error => {
    throw error;
  });
};

describe('turn driver progress hook', () => {
  it('reports activity when a tool STARTS, not only when it finishes', async () => {
    const onToolActivity = vi.fn();
    await driveTurn([toolStart()], onToolActivity);
    expect(onToolActivity).toHaveBeenCalled();
  });

  it('still reports activity when a tool finishes', async () => {
    const onToolActivity = vi.fn();
    await driveTurn([toolEnd()], onToolActivity);
    expect(onToolActivity).toHaveBeenCalled();
  });
});
