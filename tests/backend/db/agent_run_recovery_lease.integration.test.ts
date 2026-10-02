// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

const database = await import('@iki/backend/db/database');
const { getDb } = await import('@iki/backend/db/database');
const { createAgentRun, getAgentRun, listAgentRunsByStatus } = await import(
  '@iki/backend/db/agent_runs'
);
const { recoverStuckRunsOnStartup } = await import('@iki/backend/thread_session/run_tracker');
const { tryAcquireCrossProcessThreadRun } = await import('@iki/backend/db/thread_run_locks');
const { addChatMessage, getChatMessages } = await import('@iki/backend/db/chat_message');

let dataDir = '';

const now = () => new Date().toISOString();

const seedThread = (threadId: string) => {
  getDb()
    .prepare(
      `INSERT INTO chat_threads (id, title, metadata, created_at, updated_at)
       VALUES (?, ?, '{}', ?, ?)`
    )
    .run(threadId, `lease recovery ${threadId}`, now(), now());
};

const seedRun = (
  runId: string,
  threadId: string,
  status: 'running' | 'blocked'
) => {
  createAgentRun({
    id: runId,
    kind: 'chat-turn',
    status,
    threadId,
    rootRunId: runId,
    providerType: 'openai',
    model: 'test-model',
    systemPrompt: 'system prompt',
    input: {},
    working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
  } as never);
};

// F2 boundary: startup recovery may only reclaim executions whose run right is
// actually gone. A run whose thread lease is still alive belongs to another
// live process sharing this database and must not be touched — its records,
// its approvals, nor its thread's UI rows.
describe('recoverStuckRunsOnStartup respects live cross-process leases', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-run-recovery-lease-'));
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });

    seedThread('thread_live');
    seedThread('thread_dead');
    seedRun('run_live', 'thread_live', 'running');
    seedRun('run_dead_running', 'thread_dead', 'running');
    seedRun('run_dead_blocked', 'thread_dead', 'blocked');

    addChatMessage({
      id: 'assistant_live',
      thread_id: 'thread_live',
      message: JSON.stringify({
        id: 'assistant_live',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'call_live',
            toolName: 'shell',
            state: 'input-available',
            input: { command: 'sleep 30' },
          },
        ],
      }),
      timestamp: now(),
      metadata: '{}',
    });
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('leaves runs with a live thread lease untouched and reclaims only the abandoned ones', () => {
    const releaseLiveLease = tryAcquireCrossProcessThreadRun('thread_live');
    expect(releaseLiveLease).toBeTypeOf('function');

    const result = recoverStuckRunsOnStartup();

    expect(result.skippedLiveLease).toBe(1);
    expect(getAgentRun('run_live')?.status).toBe('running');
    expect(getAgentRun('run_dead_running')?.status).toBe('failed');
    expect(getAgentRun('run_dead_running')?.error).toMatchObject({ code: 'PROCESS_RESTART' });
    expect(getAgentRun('run_dead_blocked')?.status).toBe('failed');

    // The live run's UI row is mid-flight state of the other process — the
    // interrupted-tool repair must not have rewritten it.
    const liveRow = getChatMessages('thread_live').find(row => row.id === 'assistant_live');
    const parts = JSON.parse(liveRow!.message).parts as Array<Record<string, unknown>>;
    expect(parts[0]).toMatchObject({ state: 'input-available' });

    // Once the lease is gone, a later recovery pass takes over exactly the
    // abandoned run — one reclaimer, conditional claim.
    releaseLiveLease?.();
    const second = recoverStuckRunsOnStartup();
    expect(second.skippedLiveLease).toBe(0);
    expect(getAgentRun('run_live')?.status).toBe('failed');
    expect(listAgentRunsByStatus(['running', 'blocked'])).toHaveLength(0);
  });
});
