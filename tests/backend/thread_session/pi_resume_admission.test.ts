import { beforeEach, describe, expect, it, vi } from 'vitest';

const getToolCallApproval = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/db/tool_call_approval', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/db/tool_call_approval')>()),
  getToolCallApproval,
}));

const prepareToolExecution = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/thread_session/tool_execution', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/tool_execution')>()),
  prepareToolExecution,
}));

const pausedPlanRunsOnPiToolSupply = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/thread_session/turn_supply_selection', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/turn_supply_selection')>()),
  pausedPlanRunsOnPiToolSupply,
}));

import { admitPiResume } from '@iki/backend/thread_session/pi_resume_admission';
import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';

const plan = { threadId: 'thread_admit', model: 'm', providerType: 'openai' } as ExecutionPlan;

const build = (overrides: Partial<Parameters<typeof admitPiResume>[0]> = {}) =>
  admitPiResume({
    plan,
    history: [],
    pendingApprovalIds: ['approval_1'],
    onRefuse: vi.fn(),
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  prepareToolExecution.mockReset();
  getToolCallApproval.mockReset();
  pausedPlanRunsOnPiToolSupply.mockReset();
  pausedPlanRunsOnPiToolSupply.mockReturnValue(true);
  getToolCallApproval.mockReturnValue({
    approval_id: 'approval_1',
    session_id: 'session_1',
    tool_call_id: 'call_1',
    tool_name: 'write_file',
    tool_args: '{"path":"a.txt"}',
    state: 'pending',
  });
});

describe('admitPiResume', () => {
  it('builds the resume commands from the approval rows and prepares each one', () => {
    const admission = build();

    expect(admission).toEqual({
      threadId: 'thread_admit',
      commands: [
        {
          approvalId: 'approval_1',
          toolCallId: 'call_1',
          toolName: 'write_file',
          args: { path: 'a.txt' },
        },
      ],
    });
    expect(prepareToolExecution).toHaveBeenCalledWith({
      threadId: 'thread_admit',
      approvalId: 'approval_1',
    });
  });

  it('returns undefined when the paused plan never ran on the Pi supply', () => {
    pausedPlanRunsOnPiToolSupply.mockReturnValue(false);
    const onRefuse = vi.fn();

    expect(build({ onRefuse })).toBeUndefined();
    expect(prepareToolExecution).not.toHaveBeenCalled();
    expect(onRefuse).not.toHaveBeenCalled();
  });

  it('returns undefined when the plan has no thread to resume on', () => {
    expect(build({ plan: { ...plan, threadId: undefined } as ExecutionPlan })).toBeUndefined();
    expect(pausedPlanRunsOnPiToolSupply).not.toHaveBeenCalled();
  });

  it('refuses loudly when an approval row lost its execution binding', () => {
    getToolCallApproval.mockReturnValue({ approval_id: 'approval_1', state: 'pending' });
    const onRefuse = vi.fn();

    expect(() => build({ onRefuse })).toThrow(/missing its execution binding/);
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(prepareToolExecution).not.toHaveBeenCalled();
  });

  it('refuses loudly when a command cannot be prepared, keeping the refusal scoped', () => {
    prepareToolExecution.mockImplementation(() => {
      throw new Error('prepared already');
    });
    const onRefuse = vi.fn();

    expect(() => build({ onRefuse })).toThrow(/prepared already/);
    expect(onRefuse).toHaveBeenCalledTimes(1);
  });

  it('defaults missing tool args to an empty object rather than failing', () => {
    getToolCallApproval.mockReturnValue({
      approval_id: 'approval_1',
      tool_call_id: 'call_1',
      tool_name: 'write_file',
      tool_args: null,
      state: 'pending',
    });

    expect(build()!.commands[0]!.args).toEqual({});
  });
});
