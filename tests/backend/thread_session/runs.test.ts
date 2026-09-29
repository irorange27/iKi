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

  it('lets the active execution owner persist cancellation', () => {
    const abortActiveStream = vi.fn(() => true);
    const runs = createChatRuns({ abortActiveStream });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(abortActiveStream).toHaveBeenCalledWith('run_1');
    expect(tracker.rehydrateAgentRunTracker).not.toHaveBeenCalled();
    expect(db.updateAgentRun).not.toHaveBeenCalled();
  });

  it('uses the Run lifecycle writer when no stream owns the run', () => {
    const markCancelled = vi.fn();
    tracker.rehydrateAgentRunTracker.mockReturnValue({ markCancelled });
    const cancelPendingApprovalsForRun = vi.fn(() => 0);
    const runs = createChatRuns({
      abortActiveStream: () => false,
      cancelPendingApprovalsForRun,
    });

    expect(runs.cancelRun('run_1')).toEqual({ success: true });
    expect(tracker.rehydrateAgentRunTracker).toHaveBeenCalledWith('run_1');
    expect(markCancelled).toHaveBeenCalledWith({ text: 'partial response' });
    expect(cancelPendingApprovalsForRun).toHaveBeenCalledWith('run_1');
    expect(db.updateAgentRun).not.toHaveBeenCalled();
  });
});
