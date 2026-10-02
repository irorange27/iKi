// @vitest-environment node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
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

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';
import { recoverStuckRunsOnStartup } from '@iki/backend/thread_session/run_tracker';


let dataDir = '';
let dbPath = '';
let createModelCalls = 0;

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: vi.fn(() => {
      createModelCalls += 1;
      throw new Error('recovery must not call the model');
    }),
  };
});

// The child process is the OTHER deployment (desktop + daemon share one
// database). It acquires the thread lease and holds it until killed.
const makeChildScript = (dbPath: string, flagPath: string): string => `
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const db = new DatabaseSync(${JSON.stringify(dbPath)});
const now = Date.now();
// Acquire exactly like tryAcquireCrossProcessThreadRun does.
db.prepare("INSERT OR IGNORE INTO thread_run_locks (thread_id, token, expires_at) VALUES (?, ?, ?)")
  .run('thread_cross', 'child-token', now + 120000);
db.prepare('UPDATE thread_run_locks SET token = ?, expires_at = ? WHERE thread_id = ? AND expires_at <= ?')
  .run('child-token', now + 120000, 'thread_cross', now);
fs.writeFileSync(${JSON.stringify(flagPath)}, '1');
// Hold until the parent kills us; a heartbeat is irrelevant here because the
// TTL (120s) outlasts the test.
setTimeout(() => {}, 60000);
`;

// Acceptance item 10: the same session crosses restarts with its log intact;
// recovery never touches an execution whose owner is still alive, and only
// records the interruption once ownership is confirmed gone. Rebuilding
// calls nothing (no model, no tools, no auto-resume).
describe('cross-process recovery is owner-aware and recorded', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-cross-recovery-'));
    dbPath = path.join(dataDir, 'shared.db');
    initializeDatabase({ dbPath });
    seedThread('thread_cross');
    seedRun('run_cross', 'thread_cross', 'blocked');
    seedApproval();
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  const seedThread = (threadId: string) => {
    getDb()
      .prepare(
        `INSERT INTO chat_threads (id, title, metadata, created_at, updated_at)
         VALUES (?, ?, '{}', ?, ?)`
      )
      .run(threadId, `cross ${threadId}`, new Date().toISOString(), new Date().toISOString());
  };

  const seedRun = (runId: string, threadId: string, status: 'blocked' | 'completed') => {
    getDb()
      .prepare(
        `INSERT INTO agent_runs (id, kind, status, thread_id, root_run_id, provider_type, model,
          system_prompt, enabled_tools, available_skill_ids, input_json, working_json,
          output_json, error_json, created_at, updated_at)
         VALUES (?, 'chat-turn', ?, ?, ?, 'openai', 'test-model', 'system', '[]', '[]', '{}',
          '{"modelMessages":[],"accumulatedText":"","pendingApprovalIds":[],"lastStepIndex":0}',
          NULL, NULL, ?, ?)`
      )
      .run(runId, status, threadId, runId, new Date().toISOString(), new Date().toISOString());
  };

  const seedApproval = () => {
    getDb()
      .prepare(
        `INSERT INTO tool_call_approval_sessions (
          session_id, thread_id, assistant_message_id, run_id, provider_type, model,
          system_prompt, enabled_tools, available_skill_ids, created_at, updated_at)
         VALUES ('assistant_cross', 'thread_cross', 'assistant_cross', 'run_cross',
          'openai', 'test-model', 'system', '[]', '[]', ?, ?)`
      )
      .run(new Date().toISOString(), new Date().toISOString());
    getDb()
      .prepare(
        `INSERT INTO tool_call_approvals (
          approval_id, session_id, tool_call_id, tool_name, tool_args, state,
          created_at, updated_at)
         VALUES ('appr_cross', 'assistant_cross', 'call_cross', 'shell', '{}', 'pending', ?, ?)`
      )
      .run(new Date().toISOString(), new Date().toISOString());
  };

  it('leaves the other process’s execution untouched while its lease is alive', async () => {
    // The other process acquires the thread lease and holds it.
    const flagPath = path.join(dataDir, 'held.flag');
    const child = spawn(process.execPath, ['-e', makeChildScript(dbPath, flagPath)], {
      stdio: 'ignore',
    });
    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        if (fs.existsSync(flagPath)) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });

    const result = recoverStuckRunsOnStartup();
    expect(result).toMatchObject({ totalRuns: 0, failedRuns: 0, blockedRuns: 0 });
    expect(result.skippedLiveLease).toBe(1);

    // The live owner's records are untouched: run, approval, empty log.
    const run = getDb().prepare('SELECT status FROM agent_runs WHERE id = ?').get('run_cross') as {
      status: string;
    };
    expect(run.status).toBe('blocked');
    const approval = getDb()
      .prepare('SELECT state FROM tool_call_approvals WHERE approval_id = ?')
      .get('appr_cross') as { state: string };
    expect(approval.state).toBe('pending');
    expect(rebuildThreadViewFromEvents('thread_cross').events).toEqual([]);

    // Kill the child WITHOUT cleanup, then expire its lease — the process is
    // gone, the ownership is confirmably gone.
    child.kill('SIGKILL');
    await new Promise(resolve => child.on('exit', resolve));
    getDb()
      .prepare('UPDATE thread_run_locks SET expires_at = ? WHERE thread_id = ?')
      .run(Date.now() - 1, 'thread_cross');

    // Second recovery takes over and records the interruption.
    const takeover = recoverStuckRunsOnStartup();
    expect(takeover).toMatchObject({ totalRuns: 1, blockedRuns: 1 });
    expect(createModelCalls).toBe(0);

    const takenRun = getDb()
      .prepare('SELECT status FROM agent_runs WHERE id = ?')
      .get('run_cross') as { status: string };
    expect(takenRun.status).toBe('failed');
    const takenApproval = getDb()
      .prepare('SELECT state FROM tool_call_approvals WHERE approval_id = ?')
      .get('appr_cross') as { state: string };
    expect(takenApproval.state).toBe('answered');

    // The log carries the whole story: approval rejected by the system, the
    // turn failed with the restart reason. Rebuild calls nothing.
    const callsBefore = createModelCalls;
    const view = rebuildThreadViewFromEvents('thread_cross');
    expect(createModelCalls).toBe(callsBefore);
    expect(view.approvals).toEqual([
      expect.objectContaining({ approvalId: 'appr_cross', status: 'rejected', decisionSource: 'system' }),
    ]);
    expect(view.turns).toEqual([
      expect.objectContaining({
        runId: 'run_cross',
        status: 'failed',
        errorText: expect.stringContaining('approval session lost'),
      }),
    ]);
  });
});
