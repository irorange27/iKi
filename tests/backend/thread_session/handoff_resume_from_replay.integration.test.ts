// @vitest-environment node

/**
 * The two recovery read paths must derive their history from the SESSION LOG
 * replay, not from the run row's `working.modelMessages` copy.
 *
 * `agent_runs.working_json` carried a third copy of the whole conversation,
 * rewritten in full once per batch (`syncModelMessages`). The replay engine
 * already owns this derivation (`rebuildResumeHistoryFromEvents`), so the copy
 * is redundant — and worse, it was a SECOND authority that could disagree with
 * the log.
 *
 * These tests are the discriminating proof: the stored history is DELETED from
 * `working_json` (the row keeps only accumulatedText / pendingApprovalIds /
 * lastStepIndex), and both paths must still rebuild the conversation from the
 * recorded facts. On the pre-change code both read `working.modelMessages`,
 * find nothing, and degrade to "no history" — so both assertions fail.
 */
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
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addChatMessage } from '@iki/backend/db/chat_message';
import { createAgentRun } from '@iki/backend/db/agent_runs';
import * as awaitersDb from '@iki/backend/db/awaiters';
import {
  createAwaiterRunner,
  type AwaiterRunnerChatPort,
  type AwaiterRunnerHostPort,
} from '@iki/backend/awaiters/awaiter_runner';
import { buildHandoffResumeContext } from '@iki/backend/thread_session/handoff_resume';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  recordSessionEvents,
} from '@iki/backend/thread_session/session_log';
import type { Awaiter } from '@iki/backend/types/awaiters';

let dataDir = '';
let seq = 0;

/** The post-change shape: the row no longer carries a history copy at all. */
const WORKING_WITHOUT_HISTORY = {
  accumulatedText: 'phase one done',
  pendingApprovalIds: [],
  lastStepIndex: 4,
};

/** Simulate "the stored history is gone": rewrite working_json to the shape a
 *  post-change row has. Done in SQL so the test does not depend on which
 *  fields the row type currently declares. */
const stripStoredHistory = (runId: string) => {
  getDb()
    .prepare('UPDATE agent_runs SET working_json = ? WHERE id = ?')
    .run(JSON.stringify(WORKING_WITHOUT_HISTORY), runId);
};

const seedRun = (params: {
  runId: string;
  threadId: string;
  kind?: 'chat-turn' | 'awaiter-wake';
  status?: 'completed' | 'blocked';
}) => {
  createAgentRun({
    id: params.runId,
    kind: params.kind ?? 'chat-turn',
    status: params.status ?? 'completed',
    threadId: params.threadId,
    rootRunId: params.runId,
    providerType: 'openai',
    model: 'test-model',
    systemPrompt: 'system',
    enabledTools: [],
    availableSkillIds: [],
    input: {},
    working: {
      accumulatedText: '',
      pendingApprovalIds: [],
      lastStepIndex: 0,
    },
    output: null,
    error: null,
  } as never);
};

/**
 * Record a two-turn conversation in the session log: the user's request, the
 * assistant's answer carrying the `handoff` tool call, and a follow-up turn.
 * The replayed projection of these facts is the recovery history.
 */
const recordConversation = (threadId: string, runId: string) => {
  recordSessionEvents(threadId, [
    {
      type: INPUT_ACCEPTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        messageId: `user_${threadId}`,
        message: {
          id: `user_${threadId}`,
          role: 'user',
          parts: [{ type: 'text', text: 'PHASE_ONE_REQUEST_MARKER' }],
        },
      },
    },
    {
      type: MODEL_OUTPUT_COMMITTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        runId,
        messageId: `assistant_${threadId}`,
        transport: 'stream',
        message: {
          id: `assistant_${threadId}`,
          role: 'assistant',
          parts: [
            { type: 'text', text: 'PHASE_ONE_ANSWER_MARKER' },
            {
              type: 'dynamic-tool',
              toolCallId: 'call_handoff_1',
              toolName: 'handoff',
              state: 'output-available',
              input: {
                summary: 'HANDOFF_SUMMARY_MARKER',
                next_steps: 'HANDOFF_NEXT_STEPS_MARKER',
                reason: 'context_limit',
              },
              output: { success: true },
            },
          ],
        },
      },
    },
  ]);
};

describe('recovery history comes from the session log, not working.modelMessages', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-handoff-replay-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'replay.db') });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  const newThreadId = () => {
    seq += 1;
    const threadId = `thread_replay_${seq}`;
    addChatThread({ id: threadId, title: 'replay thread', metadata: '{}' });
    return threadId;
  };

  it('handoff resume rebuilds the parent transcript after the stored history is deleted', async () => {
    const threadId = newThreadId();
    const parentRunId = `run_parent_${seq}`;
    seedRun({ runId: parentRunId, threadId });
    recordConversation(threadId, parentRunId);
    // The run row loses its history copy — the log is now the only source.
    stripStoredHistory(parentRunId);

    const resumed = await buildHandoffResumeContext({
      threadId,
      preparedHistory: [],
      preparedPrompt: '',
    });

    // Old code: `parentRun.working.modelMessages` is empty → returns null, so
    // the resumed turn silently starts with no context at all.
    expect(resumed).not.toBeNull();
    const serialized = JSON.stringify(resumed!.history);
    expect(serialized).toContain('PHASE_ONE_REQUEST_MARKER');
    expect(serialized).toContain('PHASE_ONE_ANSWER_MARKER');
    expect(serialized).toContain('[HANDOFF CONTEXT]');
    // The handoff payload is read off the replayed tool-call, so the next
    // agent knows what was done and what remains.
    expect(serialized).toContain('HANDOFF_SUMMARY_MARKER');
    expect(serialized).toContain('HANDOFF_NEXT_STEPS_MARKER');
    expect(resumed!.prompt).toBe('Continue the work from where the previous agent left off.');
  });

  it('handoff resume degrades to null when the log has no history at all', async () => {
    const threadId = newThreadId();
    const parentRunId = `run_parent_empty_${seq}`;
    seedRun({ runId: parentRunId, threadId });

    // No recorded facts, no stored copy: there is nothing to resume from and
    // the caller must fall back to the prepared turn (same contract as the
    // old `if (resumedMessages.length === 0) return null`).
    const resumed = await buildHandoffResumeContext({
      threadId,
      preparedHistory: [],
      preparedPrompt: '',
    });
    expect(resumed).toBeNull();
  });

  it('awaiter wake rebuilds the origin conversation after the stored history is deleted', async () => {
    const threadId = newThreadId();
    const awaiterId = `awaiter_replay_${seq}`;
    const originRunId = `run_origin_${seq}`;

    awaitersDb.addAwaiter({
      id: awaiterId,
      thread_id: threadId,
      title: 'Deferred work',
      instruction: 'continue the deferred work',
      provider_type: 'openai',
      model: 'test-model',
      trigger_kind: 'time_after',
      trigger_spec_json: JSON.stringify({ kind: 'time_after', delay_minutes: 30 }),
      status: 'armed',
      notify: true,
      origin_run_id: originRunId,
    } as never);

    seedRun({ runId: originRunId, threadId, status: 'completed' });
    recordConversation(threadId, originRunId);
    stripStoredHistory(originRunId);
    // The wake's own run id lands in the wake-event audit row, whose run_id
    // has an FK to agent_runs — the row must exist or the wake is suppressed.
    seedRun({ runId: `run_wake_${seq}`, threadId, kind: 'awaiter-wake' });

    const sentRequests: Array<Record<string, unknown>> = [];
    const chat: AwaiterRunnerChatPort = {
      getThread: tid => ({ id: tid }),
      createMessage: input => {
        const row = input as {
          id: string;
          thread_id: string;
          message: string;
          timestamp: string;
          metadata: string;
        };
        addChatMessage({
          id: row.id,
          thread_id: row.thread_id,
          parent_id: null,
          depth: 0,
          message: row.message,
          timestamp: row.timestamp,
          metadata: row.metadata,
        });
        return input;
      },
      send: async request => {
        sentRequests.push(request as Record<string, unknown>);
        return { success: true, text: 'wake output', runId: `run_wake_${seq}` };
      },
    };
    const host: AwaiterRunnerHostPort = {
      notify: () => {},
      pushAwaiterEvent: () => {},
    };

    const result = await createAwaiterRunner({ chat, host }).runAwaiterWake(awaiterId);
    expect(result.success).toBe(true);

    // Old code: `originRun.working.modelMessages` is empty → the wake runs
    // with no resumed context, losing the whole conversation it defers from.
    const request = sentRequests[0]!;
    const serialized = JSON.stringify(request.messages);
    expect(serialized).toContain('[RESUMED CONTEXT]');
    expect(serialized).toContain('PHASE_ONE_REQUEST_MARKER');
    expect(serialized).toContain('PHASE_ONE_ANSWER_MARKER');
    // The wake instruction still closes the request.
    expect(serialized).toContain('[CONTINUATION]');
    expect(serialized).toContain('deferred continue-later wake');
  });

  it('awaiter wake degrades to no resumed context when the origin log is empty', async () => {
    const threadId = newThreadId();
    const awaiterId = `awaiter_replay_empty_${seq}`;
    const originRunId = `run_origin_empty_${seq}`;

    awaitersDb.addAwaiter({
      id: awaiterId,
      thread_id: threadId,
      title: 'Deferred work',
      instruction: 'continue the deferred work',
      provider_type: 'openai',
      model: 'test-model',
      trigger_kind: 'time_after',
      trigger_spec_json: JSON.stringify({ kind: 'time_after', delay_minutes: 30 }),
      status: 'armed',
      notify: true,
      origin_run_id: originRunId,
    } as never);
    seedRun({ runId: originRunId, threadId, status: 'completed' });
    seedRun({ runId: `run_wake_empty_${seq}`, threadId, kind: 'awaiter-wake' });

    const sentRequests: Array<Record<string, unknown>> = [];
    const chat: AwaiterRunnerChatPort = {
      getThread: tid => ({ id: tid }),
      createMessage: input => input,
      send: async request => {
        sentRequests.push(request as Record<string, unknown>);
        return { success: true, text: 'wake output', runId: `run_wake_empty_${seq}` };
      },
    };
    const host: AwaiterRunnerHostPort = {
      notify: () => {},
      pushAwaiterEvent: () => {},
    };

    const result = await createAwaiterRunner({ chat, host }).runAwaiterWake(awaiterId);
    expect(result.success).toBe(true);
    // Nothing to resume: the wake keeps its plain shape instead of inventing
    // an empty resumed-context block.
    const serialized = JSON.stringify(sentRequests[0]!.messages);
    expect(serialized).not.toContain('[RESUMED CONTEXT]');
    expect(serialized).toContain('deferred continue-later wake');
  });
});
