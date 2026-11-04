// @vitest-environment node
/**
 * Migration 004 re-encodes the tool-execution journal. This is the regression that
 * matters for a real user's database: rows written by the previous build must still
 * replay after the upgrade, because a thread whose execution facts became unreadable
 * cannot be retried at all.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { readToolExecutionFact } from '@iki/backend/thread_session/tool_execution';
import {
  TOOL_EXECUTION_FINISHED,
  TOOL_EXECUTED,
} from '@iki/backend/types/session_events';

let root: string;
const THREAD_ID = 'thread_migrate004';

/** A row in the shape the previous build wrote. */
const seedLegacyRows = () => {
  const binding = {
    threadId: THREAD_ID,
    approvalId: 'ap_migrate004',
    messageId: 'assistant_migrate004',
    toolCallId: 'call_migrate004',
    toolName: 'write_file',
    args: { path: 'notes.md' },
    workspace: null,
  };
  const insert = getDb().prepare(
    'INSERT INTO session_events (thread_id, revision, type, version, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run(
    THREAD_ID,
    1,
    TOOL_EXECUTION_FINISHED,
    1,
    JSON.stringify({
      binding,
      decision: 'approved',
      result: {
        type: 'tool-result',
        toolCallId: 'call_migrate004',
        toolName: 'write_file',
        output: { type: 'text', value: 'written' },
      },
      source: 'execution',
    }),
    new Date().toISOString()
  );
  insert.run(
    THREAD_ID,
    2,
    TOOL_EXECUTION_FINISHED,
    1,
    JSON.stringify({
      binding: { ...binding, approvalId: 'ap_interrupted' },
      decision: 'approved',
      result: {
        type: 'tool-result',
        toolCallId: 'call_interrupted',
        toolName: 'shell',
        output: {
          type: 'error-json',
          value: {
            code: 'tool-execution-interrupted',
            message: 'Tool shell was interrupted',
            storedReplay: 'unsafe',
            declaredReplay: 'safe',
          },
        },
      },
      replay: 'unsafe',
      source: 'recovery',
    }),
    new Date().toISOString()
  );
  insert.run(
    THREAD_ID,
    3,
    TOOL_EXECUTED,
    1,
    JSON.stringify({
      runId: 'run_migrate004',
      toolCallId: 'call_inline',
      toolName: 'read_file',
      args: { path: 'a' },
      result: {
        type: 'tool-result',
        toolCallId: 'call_inline',
        toolName: 'read_file',
        output: { type: 'text', value: 'inline' },
      },
    }),
    new Date().toISOString()
  );
  insert.run(
    THREAD_ID,
    4,
    'input_accepted',
    1,
    JSON.stringify({
      messageId: 'input_migrate004',
      message: { id: 'input_migrate004', role: 'user', parts: [{ type: 'text', text: 'go' }] },
      runId: 'run_migrate004',
      system: ['stale composed prompt copy'],
    }),
    new Date().toISOString()
  );
};

describe('migration 004: one shape per execution fact', () => {
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-migrate004-'));
    const dbPath = path.join(root, 'legacy.db');
    // Open once to build the schema, seed the OLD shapes, then close and reopen so
    // the migration runs exactly as it does for a user upgrading the app.
    initializeDatabase({ dbPath });
    // Stand in for a database from the PREVIOUS build: migrations up to 003 are
    // recorded, 004 is not, and the journal rows are in the old shape.
    getDb().prepare("DELETE FROM migrations WHERE name = '004_one_shape_per_execution_fact'").run();
    seedLegacyRows();
    closeDatabase();
    initializeDatabase({ dbPath });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('relocates the recorded output onto the fact, keeping the binding as the identity', () => {
    const finished = getSessionEvents(THREAD_ID, [TOOL_EXECUTION_FINISHED])[0];
    const payload = finished.payload as Record<string, unknown>;

    expect(payload.result).toBeUndefined();
    expect(payload.output).toEqual({ type: 'text', value: 'written' });
    // The reader that recovery depends on resolves the same exchange it would have
    // before the upgrade — this is what keeps an old thread retryable.
    const fact = readToolExecutionFact(finished);
    expect(fact).toMatchObject({ kind: 'exchange', approvalId: 'ap_migrate004' });
    if (fact?.kind !== 'exchange') throw new Error('expected an exchange');
    expect(fact.exchange).toMatchObject({
      toolCallId: 'call_migrate004',
      toolName: 'write_file',
      args: { path: 'notes.md' },
      output: { type: 'text', value: 'written' },
    });
  });

  it('states a refused replay as a fact instead of text the reader must parse', () => {
    const interrupted = getSessionEvents(THREAD_ID, [TOOL_EXECUTION_FINISHED])[1];
    const payload = interrupted.payload as { interruption?: Record<string, unknown> };

    expect(payload.interruption).toEqual({ storedReplay: 'unsafe', declaredReplay: 'safe' });
    // The model-facing error value is untouched: only the journal gained structure.
    expect((payload as { output?: { value?: { code?: string } } }).output?.value?.code).toBe(
      'tool-execution-interrupted'
    );
  });

  it('relocates inline execution facts the same way', () => {
    const inline = getSessionEvents(THREAD_ID, [TOOL_EXECUTED])[0].payload as Record<string, unknown>;

    expect(inline.result).toBeUndefined();
    expect(inline.output).toEqual({ type: 'text', value: 'inline' });
    expect(inline.toolCallId).toBe('call_inline');
  });

  it('drops the stale system-prompt copy from accepted inputs', () => {
    const input = getSessionEvents(THREAD_ID, ['input_accepted'])[0].payload as Record<
      string,
      unknown
    >;

    expect(input.system).toBeUndefined();
    expect(input.messageId).toBe('input_migrate004');
  });
});
