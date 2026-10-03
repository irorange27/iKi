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

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatMessage, getChatMessages } from '@iki/backend/db/chat_message';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { createAgentRun } from '@iki/backend/db/agent_runs';
import * as awaitersDb from '@iki/backend/db/awaiters';
import {
  createAwaiterRunner,
  type AwaiterRunnerChatPort,
  type AwaiterRunnerHostPort,
} from '@iki/backend/awaiters/awaiter_runner';
import type { Awaiter } from '@iki/backend/types/awaiters';

let dataDir = '';
let seq = 0;

// Stage E: the awaiter wake business runs in backend with a fake chat and a
// fake host. The regressions pin the wake business's real decisions — the
// resumed-context prompt, the post-wake dispositions (suppress on cancel),
// the wake-event audit rows and the failure lifecycle.
describe('awaiter runner (backend)', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-awaiters-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'runner.db') });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  const buildRunner = ({ sendOverride }: { sendOverride?: AwaiterRunnerChatPort['send'] } = {}) => {
    const sentRequests: Array<Record<string, unknown>> = [];
    const createdMessages: Array<Record<string, unknown>> = [];
    const notifications: Array<{ title: string; body: string }> = [];
    const pushedEvents: unknown[] = [];

    const chat: AwaiterRunnerChatPort = {
      getThread: threadId => ({ id: threadId }),
      createMessage: input => {
        createdMessages.push(input as Record<string, unknown>);
        const row = input as {
          id: string;
          thread_id: string;
          message: string;
          timestamp: string;
          metadata: string;
        };
        // Persist for real: the wake messages must satisfy the thread FK.
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
      send: sendOverride ?? (async (request: unknown) => {
        sentRequests.push(request as Record<string, unknown>);
        return { success: true, text: 'wake output', runId: 'run_wake_1' };
      }),
    };
    const host: AwaiterRunnerHostPort = {
      notify: params => notifications.push(params),
      pushAwaiterEvent: payload => pushedEvents.push(payload),
    };
    const runner = createAwaiterRunner({ chat, host });
    return { runner, chat, sentRequests, createdMessages, notifications, pushedEvents };
  };

  const seedAwaiter = (overrides: Partial<Awaiter> = {}) => {
    seq += 1;
    const awaiterId = `awaiter_${seq}`;
    const threadId = `thread_${seq}`;
    addChatThread({ id: threadId, title: 'awaiter thread', metadata: '{}' });
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
      ...overrides,
    } as never);
    return { awaiterId, threadId };
  };

  const seedOriginRun = (runId: string, threadId: string) => {
    createAgentRun({
      id: runId,
      kind: 'chat-turn',
      status: 'completed',
      threadId,
      rootRunId: runId,
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system',
      input: {},
      working: {
        modelMessages: [{ role: 'user', content: 'earlier conversation turn' }],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
    } as never);
  };

  it('wakes an armed awaiter with resumed context and records the audit row', async () => {
    const { awaiterId, threadId } = seedAwaiter({ origin_run_id: 'run_origin' });
    seedOriginRun('run_origin', threadId);
    // The wake's returned runId lands in the wake-event audit row, whose
    // run_id has an FK to agent_runs — seed the wake run too.
    createAgentRun({
      id: 'run_wake_1',
      kind: 'awaiter-wake',
      status: 'completed',
      threadId,
      rootRunId: 'run_wake_1',
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system',
      input: {},
      working: {
        modelMessages: [],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
    } as never);

    const deps = buildRunner();
    const result = await deps.runner.runAwaiterWake(awaiterId);
    expect(result).toMatchObject({ success: true, runId: 'run_wake_1' });

    // The wake prompt carries the resumed context and the wake instruction.
    const request = deps.sentRequests[0]!;
    const requestMessages = request.messages as Array<{ role: string; content: string }>;
    expect(requestMessages[0]!.content).toContain('deferred continue-later wake');
    expect(JSON.stringify(requestMessages)).toContain('earlier conversation turn');
    expect(JSON.stringify(requestMessages)).toContain('Continuation objective');
    expect((request.runConfig as { kind: string }).kind).toBe('awaiter-wake');
    expect((request.runConfig as { parentRunId?: string }).parentRunId).toBe('run_origin');

    // The completion message landed in the thread; the awaiter settled; the
    // host was notified and pushed.
    const threadMessages = getChatMessages(threadId);
    expect(JSON.stringify(threadMessages.map(row => row.message))).toContain('wake output');
    expect(awaitersDb.getAwaiter(awaiterId)).toMatchObject({ status: 'completed' });
    expect(deps.notifications).toEqual([
      expect.objectContaining({ title: expect.stringContaining('Later continuation') }),
    ]);
    expect(deps.pushedEvents).toHaveLength(1);
  });

  it('suppresses the wake when the awaiter was cancelled mid-flight', async () => {
    const { awaiterId } = seedAwaiter();

    const deps = buildRunner({
      sendOverride: async () => {
        // The user deletes/cancels the awaiter while the wake is in flight.
        awaitersDb.deleteAwaiter(awaiterId);
        return { success: true, text: 'late output', runId: 'run_wake_2' };
      },
    });

    const result = await deps.runner.runAwaiterWake(awaiterId);
    expect(result).toMatchObject({ success: false, error: 'Awaiter no longer exists' });

    // Suppressed: no completion message, no notification, no push.
    expect(deps.createdMessages).toHaveLength(0);
    expect(deps.notifications).toHaveLength(0);
    expect(deps.pushedEvents).toHaveLength(0);
  });

  it('suppresses the wake when the awaiter is cancelled but not deleted', async () => {
    // The disposition logic is the SOLE guard here: the awaiter row still
    // exists, so the FK backstops cannot mask a broken disposition check.
    const { awaiterId } = seedAwaiter();

    const deps = buildRunner({
      sendOverride: async () => {
        awaitersDb.updateAwaiter(awaiterId, { status: 'cancelled' });
        return { success: true, text: 'late output', runId: 'run_wake_3' };
      },
    });

    const result = await deps.runner.runAwaiterWake(awaiterId);
    expect(result).toMatchObject({ success: false, error: 'Awaiter no longer exists' });
    expect(deps.createdMessages).toHaveLength(0);
    expect(deps.notifications).toHaveLength(0);
    expect(deps.pushedEvents).toHaveLength(0);
    // The cancelled row keeps its status; no success audit row appears.
    expect(awaitersDb.getAwaiter(awaiterId)).toMatchObject({ status: 'cancelled' });
  });

  it('records the failure lifecycle when the wake errors', async () => {
    const { awaiterId, threadId } = seedAwaiter();

    const deps = buildRunner({
      sendOverride: async () => ({ success: false, error: 'wake exploded' }),
    });

    const result = await deps.runner.runAwaiterWake(awaiterId);
    expect(result).toMatchObject({ success: false, error: 'wake exploded' });

    const awaiter = awaitersDb.getAwaiter(awaiterId)!;
    expect(awaiter.status).toBe('failed');
    expect(awaiter.last_error).toBe('wake exploded');

    const threadMessages = getChatMessages(threadId);
    expect(JSON.stringify(threadMessages.map(row => row.message))).toContain('wake exploded');
    expect(deps.notifications).toEqual([
      expect.objectContaining({ title: expect.stringContaining('Continuation failed') }),
    ]);
  });
});
