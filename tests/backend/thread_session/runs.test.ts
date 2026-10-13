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
const sessionEvents = vi.hoisted(() => ({
  getSessionEvents: vi.fn(() => []),
}));

vi.mock('@iki/backend/db/agent_runs', () => db);
vi.mock('@iki/backend/thread_session/run_tracker', () => tracker);
vi.mock('@iki/backend/db/session_events', () => sessionEvents);
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

  it('refuses to write a terminal state for a running run nothing owns', () => {
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

  it('cancels a paused run through the Run lifecycle writer', () => {
    // A blocked run waits for an approval decision and is not executing, so
    // cancelling it is a decision about a paused run, not a fabricated stop.
    db.getAgentRun.mockReturnValue({ ...activeRun, status: 'blocked' });
    const markCancelled = vi.fn();
    tracker.rehydrateAgentRunTracker.mockReturnValue({ markCancelled });
    const cancelPendingApprovalsForRun = vi.fn(() => 1);
    const runs = createChatRuns({
      abortActiveStream: () => false,
      cancelExecution: () => false,
      cancelPendingApprovalsForRun,
    });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(markCancelled).toHaveBeenCalledWith({ text: 'partial response' });
    expect(cancelPendingApprovalsForRun).toHaveBeenCalledWith('run_1');
  });

  it('cancels a queued run that has not started', () => {
    db.getAgentRun.mockReturnValue({ ...activeRun, status: 'queued' });
    const markCancelled = vi.fn();
    tracker.rehydrateAgentRunTracker.mockReturnValue({ markCancelled });
    const runs = createChatRuns({
      abortActiveStream: () => false,
      cancelExecution: () => false,
    });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(markCancelled).toHaveBeenCalled();
  });

  it('records the terminal fact for a paused run whose start the log holds', () => {
    // `blocked` runs recorded `turn_started` before pausing, so replay must
    // be told the pause is over — otherwise the run reads as running forever.
    sessionEvents.getSessionEvents.mockReturnValue([{ revision: 1 }]);
    db.getAgentRun.mockReturnValue({ ...activeRun, status: 'blocked' });
    tracker.rehydrateAgentRunTracker.mockReturnValue({ markCancelled: vi.fn() });
    const runs = createChatRuns({
      abortActiveStream: () => false,
      cancelExecution: () => false,
    });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(sessionEvents.getSessionEvents).toHaveBeenCalledWith(
      'thread_1',
      ['turn_started'],
      { path: '$.runId', value: 'run_1' }
    );
  });

  it('does not invent a turn in the replay for a run that never started', () => {
    // A `queued` row records no `turn_started` until it is adopted. Writing a
    // terminal fact for it would materialize a turn in the replay that nothing
    // else knows about, with a defaulted kind.
    sessionEvents.getSessionEvents.mockReturnValue([]);
    db.getAgentRun.mockReturnValue({ ...activeRun, status: 'queued' });
    tracker.rehydrateAgentRunTracker.mockReturnValue({ markCancelled: vi.fn() });
    const runs = createChatRuns({
      abortActiveStream: () => false,
      cancelExecution: () => false,
    });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    // The run row is terminal, but the log gains no terminal fact for it.
    expect(sessionEvents.getSessionEvents).toHaveBeenCalled();
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
