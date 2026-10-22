// @vitest-environment node

/**
 * Cancelling a run is a decision about who owns it: the live execution in this
 * process, another process holding the thread lease, or nobody at all. This
 * suite asserts the outcome of that decision against a real database.
 *
 * The previous version mocked four db modules and asserted which writer
 * functions were called with which arguments. It could pass while the stored
 * row was wrong, and it broke on every writer signature change. A run's status
 * after `cancelRun` is the fact a caller cares about; how it got written is
 * not.
 *
 * Two dependencies stay injected because they describe PROCESS state a
 * database cannot hold: whether a live execution exists in this process, and
 * whether another process holds the lease. Those are the only mocks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { createAgentRun, getAgentRun } from '@iki/backend/db/agent_runs';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { createChatRuns } from '@iki/backend/thread_session/runs';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { TURN_STARTED, recordSessionEvents } from '@iki/backend/thread_session/session_log';

const created: string[] = [];

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-runs-'));
  created.push(dir);
  initializeDatabase({ dbPath: path.join(dir, 'runs.db') });
});

afterAll(() => {
  closeDatabase();
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let counter = 0;

/** Store a run in the given status, optionally with a recorded start fact. */
const seedRun = (params: {
  status: 'running' | 'blocked' | 'queued' | 'completed';
  withStartFact?: boolean;
  accumulatedText?: string;
}) => {
  counter += 1;
  const runId = `run_${counter}`;
  const threadId = `thread_${counter}`;
  addChatThread({ id: threadId, title: `Thread ${counter}`, metadata: '{}' });
  createAgentRun({
    id: runId,
    kind: 'chat-turn',
    status: params.status,
    threadId,
    rootRunId: runId,
    providerType: 'openai',
    model: 'test-model',
    systemPrompt: '',
    enabledTools: [],
    availableSkillIds: [],
    input: {},
    working: {
      accumulatedText: params.accumulatedText ?? 'partial response',
      pendingApprovalIds: [],
      lastStepIndex: 1,
    },
  } as never);

  if (params.withStartFact) {
    recordSessionEvents(threadId, [
      { type: TURN_STARTED, version: 1, payload: { runId, kind: 'chat-turn' } },
    ]);
  }

  return { runId, threadId };
};

/** The two process-level facts a database cannot express. */
const buildRuns = (params: {
  executionAlive?: boolean;
  leaseHeldElsewhere?: boolean;
  cancelPendingApprovalsForRun?: (runId: string) => number;
}) =>
  createChatRuns({
    abortActiveStream: () => params.executionAlive === true,
    cancelExecution: params.cancelExecution,
    hasLiveThreadLease: () => params.leaseHeldElsewhere === true,
    ...(params.cancelPendingApprovalsForRun
      ? { cancelPendingApprovalsForRun: params.cancelPendingApprovalsForRun }
      : {}),
  } as never);

describe('run cancellation', () => {
  it('reaches the live execution in this process and leaves the row to its owner', () => {
    const { runId } = seedRun({ status: 'running' });
    const cancelExecution = vi.fn(() => true);
    const runs = buildRuns({ cancelExecution } as never);

    expect(runs.cancelRun(runId)).toEqual({ success: true });
    expect(cancelExecution).toHaveBeenCalledWith(runId, 'run-cancelled');
    // The execution owner writes its own terminal state; cancelRun must not
    // write one on its behalf, so the row is still `running` here.
    expect(getAgentRun(runId)!.status).toBe('running');
  });

  it('refuses when another process holds the thread lease, leaving the row running', () => {
    const { runId } = seedRun({ status: 'running' });
    const runs = buildRuns({ executionAlive: false, leaseHeldElsewhere: true });

    const result = runs.cancelRun(runId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('another live process');
    expect(getAgentRun(runId)!.status).toBe('running');
  });

  it('reclaims a running run nobody owns', () => {
    const { runId } = seedRun({ status: 'running' });
    const cancelPendingApprovalsForRun = vi.fn(() => 0);
    const runs = buildRuns({ executionAlive: false, leaseHeldElsewhere: false, cancelPendingApprovalsForRun });

    const result = runs.cancelRun(runId);
    expect(result.success).toBe(true);
    expect(result.error).toContain('reclaimed as cancelled');
    expect(getAgentRun(runId)!.status).toBe('cancelled');
    expect(cancelPendingApprovalsForRun).toHaveBeenCalledWith(runId);
  });

  it('cancels a paused run and records the terminal fact', () => {
    const { runId } = seedRun({ status: 'blocked', withStartFact: true });
    const runs = buildRuns({ executionAlive: false, leaseHeldElsewhere: false });

    expect(runs.cancelRun(runId).success).toBe(true);

    // Both projections agree: the row is cancelled...
    expect(getAgentRun(runId)!.status).toBe('cancelled');
    // ...and the log carries the turn it is cancelling, so a replay can tell
    // this apart from a run that never started.
    const started = getSessionEvents(`thread_${counter}`, [TURN_STARTED], {
      path: '$.runId',
      value: runId,
    });
    expect(started).toHaveLength(1);
  });

  it('cancels a queued run that has not started', () => {
    const { runId } = seedRun({ status: 'queued' });
    const runs = buildRuns({ executionAlive: false, leaseHeldElsewhere: false });

    expect(runs.cancelRun(runId).success).toBe(true);
    expect(getAgentRun(runId)!.status).toBe('cancelled');
  });

  it('refuses a run that already ended', () => {
    const { runId } = seedRun({ status: 'completed' });
    const runs = buildRuns({ executionAlive: false, leaseHeldElsewhere: false });

    const result = runs.cancelRun(runId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already completed');
    // Untouched.
    expect(getAgentRun(runId)!.status).toBe('completed');
  });

  it('refuses an unknown run id', () => {
    const runs = buildRuns({ executionAlive: false, leaseHeldElsewhere: false });
    expect(runs.cancelRun('run_does_not_exist')).toEqual({
      success: false,
      error: 'Run not found',
    });
  });
});
