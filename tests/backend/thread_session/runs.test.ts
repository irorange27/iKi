import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getAgentRun: vi.fn(),
  getAgentRunTrace: vi.fn(),
  getAgentRunTree: vi.fn(),
  listAgentRunsByThread: vi.fn(),
  listAgentRunsByStatus: vi.fn(),
  listAgentRunsByKinds: vi.fn(),
  createAgentRun: vi.fn(),
  updateAgentRun: vi.fn(),
}));
const tracker = vi.hoisted(() => ({
  rehydrateAgentRunTracker: vi.fn(),
}));

vi.mock('@iki/backend/db/agent_runs', () => db);
vi.mock('@iki/backend/thread_session/run_tracker', () => tracker);
vi.mock('@iki/backend/thread_session/atif_export', () => ({
  buildRunTrajectory: vi.fn(),
}));
vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: vi.fn(),
}));
vi.mock('@iki/backend/db/tasks', () => ({
  getProactiveTask: vi.fn(),
}));

import { createChatRuns } from '@iki/backend/thread_session/runs';

const activeRun = {
  id: 'run_1',
  kind: 'chat-turn',
  status: 'running',
  threadId: 'thread_1',
  rootRunId: 'run_1',
  providerType: 'openai',
  model: 'test-model',
  systemPrompt: '',
  enabledTools: [],
  availableSkillIds: [],
  input: {},
  working: {
    modelMessages: [],
    accumulatedText: 'partial response',
    pendingApprovalIds: [],
    lastStepIndex: 1,
  },
  output: null,
  error: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:01.000Z',
};

describe('chat run cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getAgentRun.mockReturnValue(activeRun);
  });

  it('reaches the live execution that owns the run', () => {
    const abortActiveStream = vi.fn(() => true);
    const cancelExecution = vi.fn(() => true);
    const runs = createChatRuns({ abortActiveStream, cancelExecution });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(cancelExecution).toHaveBeenCalledWith('run_1', 'run-cancelled');
    expect(abortActiveStream).not.toHaveBeenCalled();
    // The execution owner persists its own terminal state; cancelRun must not
    // write one on its behalf.
    expect(db.updateAgentRun).not.toHaveBeenCalled();
  });

  it('refuses to write a terminal state when no live execution owns the run', () => {
    const abortActiveStream = vi.fn(() => false);
    const cancelExecution = vi.fn(() => false);
    const markCancelled = vi.fn();
    tracker.rehydrateAgentRunTracker.mockReturnValue({ markCancelled });
    const runs = createChatRuns({ abortActiveStream, cancelExecution });

    const result = runs.cancelRun('run_1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No live execution owns this run');
    // The old behavior wrote `cancelled` for a run nothing had stopped.
    expect(markCancelled).not.toHaveBeenCalled();
    expect(tracker.rehydrateAgentRunTracker).not.toHaveBeenCalled();
    expect(db.updateAgentRun).not.toHaveBeenCalled();
  });

  it('falls back to the stream abort for callers without the run-keyed index', () => {
    const abortActiveStream = vi.fn(() => true);
    const cancelPendingApprovalsForRun = vi.fn(() => 0);
    const runs = createChatRuns({ abortActiveStream, cancelPendingApprovalsForRun });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(abortActiveStream).toHaveBeenCalledWith('run_1');
    expect(cancelPendingApprovalsForRun).toHaveBeenCalledWith('run_1');
    expect(db.updateAgentRun).not.toHaveBeenCalled();
  });
});
