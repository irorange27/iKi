import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordSessionEvents = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/thread_session/session_log', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/session_log')>()),
  recordSessionEvents,
}));

const upsertToolCallApprovalSession = vi.hoisted(() => vi.fn());
const upsertToolCallApprovals = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/db/tool_call_approval', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/db/tool_call_approval')>()),
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
}));

import { persistApprovalBatch } from '@iki/backend/thread_session/approval_persistence';
import type { ApprovalRecoveryContext } from '@iki/backend/thread_session/approval_types';
import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';

const plan = {
  threadId: 'thread_persist',
  providerType: 'openai',
  providerId: 'provider_1',
  model: 'gpt-test',
  systemPrompt: 'sys',
  enableTools: true,
  enabledTools: ['write_file'],
  availableSkillIds: [],
  requireApproval: true,
  autoApproveToolRequests: false,
  budget: { step: 20 },
  skillMode: 'manual',
  kind: 'chat-turn',
  runMetadata: {},
  transport: 'stream',
} as unknown as ExecutionPlan;

const recoveryContext: ApprovalRecoveryContext = {
  plan,
  sessionId: 'assistant_persist',
  assistantMessageId: 'assistant_persist',
  runId: 'run_persist',
};

const requests = [
  {
    approvalId: 'approval_a',
    toolCallId: 'call_a',
    toolCall: { toolName: 'write_file', args: { path: 'a.txt' } },
  },
  { approvalId: 'approval_b' },
];

beforeEach(() => {
  vi.clearAllMocks();
  recordSessionEvents.mockReset();
  upsertToolCallApprovalSession.mockReset();
  upsertToolCallApprovals.mockReset();
});

describe('persistApprovalBatch', () => {
  it('records the log facts before writing the rows', () => {
    const order: string[] = [];
    recordSessionEvents.mockImplementation(() => order.push('fact'));
    upsertToolCallApprovalSession.mockImplementation(() => order.push('session-row'));
    upsertToolCallApprovals.mockImplementation(() => order.push('approval-rows'));

    persistApprovalBatch({ requests, recoveryContext });

    // A crash after the fact but before the rows leaves an approval the replay
    // can see and the resume refuses — the safe direction.
    expect(order).toEqual(['fact', 'session-row', 'approval-rows']);
  });

  it('writes one fact per request carrying its binding', () => {
    persistApprovalBatch({ requests, recoveryContext });

    const [threadId, events] = recordSessionEvents.mock.calls[0]!;
    expect(threadId).toBe('thread_persist');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'approval_requested',
      payload: {
        approvalId: 'approval_a',
        sessionId: 'assistant_persist',
        runId: 'run_persist',
        toolCallId: 'call_a',
        toolName: 'write_file',
        args: { path: 'a.txt' },
      },
    });
    expect(events[1]).toMatchObject({ payload: { approvalId: 'approval_b' } });
  });

  it('persists the full plan on the session row so a resume can rebuild it', () => {
    persistApprovalBatch({ requests, recoveryContext });

    const session = upsertToolCallApprovalSession.mock.calls[0]![0];
    expect(session).toMatchObject({
      session_id: 'assistant_persist',
      thread_id: 'thread_persist',
      run_id: 'run_persist',
      model: 'gpt-test',
      max_iterations: 20,
      enabled_tools: '["write_file"]',
    });
    expect(typeof session.plan_json).toBe('string');
    expect(session.plan_json).toContain('thread_persist');
  });

  it('marks every approval row pending with its tool args serialized', () => {
    persistApprovalBatch({ requests, recoveryContext });

    const rows = upsertToolCallApprovals.mock.calls[0]![0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      approval_id: 'approval_a',
      tool_call_id: 'call_a',
      tool_name: 'write_file',
      tool_args: '{"path":"a.txt"}',
      state: 'pending',
    });
    expect(rows[1]).toMatchObject({
      approval_id: 'approval_b',
      tool_call_id: null,
      tool_name: null,
      tool_args: null,
      state: 'pending',
    });
  });

  it('skips the log fact when the plan has no thread, but still writes the rows', () => {
    persistApprovalBatch({
      requests,
      recoveryContext: { ...recoveryContext, plan: { ...plan, threadId: undefined } as ExecutionPlan },
    });

    expect(recordSessionEvents).not.toHaveBeenCalled();
    expect(upsertToolCallApprovalSession).toHaveBeenCalledTimes(1);
    expect(upsertToolCallApprovals).toHaveBeenCalledTimes(1);
  });
});
