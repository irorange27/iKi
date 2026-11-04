// @vitest-environment node

// Task-1 P0 regression: an assistant commit written through the production
// persist chain must carry the run that wrote it. Before the fix,
// turn_prep/persistence.updateMessage guessed `runId` out of the message body
// and always wrote '' — and the replay's dead-chain exclusion drops commits by
// runId only. So the '' copy of a DEAD run always survived, its settled tool
// parts were converted to tool-call + tool-result by the UI→model projection,
// and journaledExchangePairs appended the same toolCallId again from the
// TOOL_EXECUTED fact: duplicate toolCallIds in one retry request → provider 400.
// This test drives the REAL writers; it fails on the old code (two pairs) and
// passes with the stamp (one pair).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { persistAssistantTurnMessage } from '@iki/backend/thread_session/turn_persistence';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  TOOL_EXECUTED,
  recordSessionEvents,
  rebuildThreadViewFromEvents,
  turnFactsToEvents,
} from '@iki/backend/thread_session/session_log';
import { rebuildResumeHistoryFromEvents } from '@iki/backend/thread_session/run_rehydrator';
import type { ModelMessage } from '@iki/backend/message/model_history';

const THREAD_ID = 'thread_dead_run_replay';
const DEAD_RUN_ID = 'run_dead_1';

let root = '';

const seedTextPart = { type: 'text', text: 'Reading the file now.', state: 'done' } as const;
const settledToolPart = {
  type: 'dynamic-tool',
  toolCallId: 'call_1',
  toolName: 'read_file',
  state: 'output-available',
  input: { path: 'a.ts' },
  output: { type: 'text', value: 'file a contents' },
} as const;

const countToolParts = (
  history: ModelMessage[],
  role: 'assistant' | 'tool',
  partType: 'tool-call' | 'tool-result'
): string[] => {
  const ids: string[] = [];
  for (const message of history) {
    if (message.role !== role || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const candidate = part as { type?: unknown; toolCallId?: unknown };
      if (candidate.type === partType && typeof candidate.toolCallId === 'string') {
        ids.push(candidate.toolCallId);
      }
    }
  }
  return ids;
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-dead-run-'));
  initializeDatabase({ dbPath: path.join(root, 'dead-run.db') });
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('a dead run is fully excluded from the retry request', () => {
  it('stamps the writing run on the persisted commit through the production chain', async () => {
    const persistence = createChatPersistence({
      rebuildMessages: threadId => rebuildThreadViewFromEvents(threadId).messages,
    });

    // 1. The user input, through the production input writer.
    persistence.createMessage({
      id: 'u1',
      thread_id: THREAD_ID,
      message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'read a.ts' }] },
    });

    // 2. The run's tool effect, journaled by the session-log append entry.
    recordSessionEvents(THREAD_ID, [
      {
        type: TOOL_EXECUTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: DEAD_RUN_ID,
          toolCallId: 'call_1',
          toolName: 'read_file',
          args: { path: 'a.ts' },
          output: { type: 'text', value: 'file a contents' },
        },
      },
    ]);

    // 3. The assistant message, through the production persist chain.
    await persistAssistantTurnMessage(
      persistence,
      THREAD_ID,
      { id: 'a1', role: 'assistant', parts: [seedTextPart, settledToolPart] },
      'stream',
      { runId: DEAD_RUN_ID }
    );

    // 4. The run dies.
    recordSessionEvents(THREAD_ID, turnFactsToEvents({
      terminal: { runId: DEAD_RUN_ID, status: 'failed', errorText: 'provider 400' },
    }));

    // The stamp itself is what the exclusion matches on — pin it in the log,
    // not in a hand-written event.
    const commit = rebuildThreadViewFromEvents(THREAD_ID).events.find(
      event => event.type === MODEL_OUTPUT_COMMITTED
    );
    expect(commit).toBeDefined();
    expect((commit!.payload as { runId?: string }).runId).toBe(DEAD_RUN_ID);

    // The display view still shows the settled assistant message (exclusion is
    // the replay-input's concern only).
    expect(persistence.listMessages(THREAD_ID).map(message => message.id)).toEqual([
      'u1',
      'a1',
    ]);

    // 5. The retry request: replay the log with the dead chain excluded.
    const resumed = await rebuildResumeHistoryFromEvents(THREAD_ID, [DEAD_RUN_ID]);
    expect(resumed).not.toBeNull();

    // Every toolCallId appears exactly once: the journaled exchange pair.
    // On the old code the unstamped ('' runId) commit survived the exclusion
    // and its settled tool part re-emitted call_1 as a second pair.
    const callIds = countToolParts(resumed!.history, 'assistant', 'tool-call');
    const resultIds = countToolParts(resumed!.history, 'tool', 'tool-result');
    expect(callIds).toEqual(['call_1']);
    expect(resultIds).toEqual(['call_1']);
    expect(resumed!.continuation).toBe(true);

    // The input still leads the request.
    expect(resumed!.history[0]!.role).toBe('user');
  });

  it('an unstamped assistant commit is refused before it can poison the log', async () => {
    const persistence = createChatPersistence({
      rebuildMessages: threadId => rebuildThreadViewFromEvents(threadId).messages,
    });

    // Same message shape as above, but written through the bare CRUD surface
    // with no run stamp: refused, nothing appended.
    expect(() =>
      persistence.upsertTurnMessage({
        id: 'a9',
        thread_id: THREAD_ID,
        message: { id: 'a9', role: 'assistant', parts: [seedTextPart, settledToolPart] },
      })
    ).toThrow(/runId/);

    expect(rebuildThreadViewFromEvents(THREAD_ID).events).toEqual([]);
  });

  it('control: the old writer shape (runId "") reproduces the duplicate tool call', async () => {
    // This is not the production path — it re-creates exactly what
    // updateMessage used to write (`runId: parsed.runId ?? ''`, always empty)
    // to prove the assertions above are the right ones: an unstamped copy of a
    // dead run's commit survives the exclusion and its settled tool part
    // duplicates the journaled exchange. If this control ever stops showing
    // the duplicate, the exclusion it documents has moved and the production
    // pin above needs re-reading.
    const { appendSessionFacts } = await import('@iki/backend/db/session_events');
    appendSessionFacts(THREAD_ID, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'u1',
          message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'read a.ts' }] },
          transport: 'send',
        },
      },
      {
        type: TOOL_EXECUTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: DEAD_RUN_ID,
          toolCallId: 'call_1',
          toolName: 'read_file',
          args: { path: 'a.ts' },
          output: { type: 'text', value: 'file a contents' },
        },
      },
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        // The old guess: runId always ''.
        payload: {
          runId: '',
          messageId: 'a1',
          message: { id: 'a1', role: 'assistant', parts: [seedTextPart, settledToolPart] },
          transport: 'stream',
        },
      },
      ...turnFactsToEvents({
        terminal: { runId: DEAD_RUN_ID, status: 'failed', errorText: 'provider 400' },
      }),
    ]);

    const resumed = await rebuildResumeHistoryFromEvents(THREAD_ID, [DEAD_RUN_ID]);
    expect(resumed).not.toBeNull();
    expect(countToolParts(resumed!.history, 'assistant', 'tool-call')).toEqual([
      'call_1',
      'call_1',
    ]);
  });
});
