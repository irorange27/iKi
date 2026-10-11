// @vitest-environment node

/**
 * ADR 008 unit F3 (issue #134): retry and queued-resume rebuild their input
 * from the session log replay — the run row's input copy is no longer the
 * authority. Two consequences pinned here: a run whose row lost its input
 * copy still retries from the recorded facts, and a retry carries the failed
 * turn's COMMITTED partial exchange (the old row-copy source discarded it, so
 * the provider could re-issue a tool call whose effect already happened).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));

import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';

describe('retry and queued resume read the session log alone', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 3, send: vi.fn() };

  const seedRun = (runId: string, threadId: string, status: 'failed' | 'queued') => {
    agentRunDb.createAgentRun({
      id: runId,
      kind: 'chat-turn',
      status,
      threadId,
      rootRunId: runId,
      providerType: 'openai',
      model: 'resume-model',
      systemPrompt: 'resume system',
      enabledTools: [],
      availableSkillIds: [],
      // The row's input copy is LOST — the recovery source is the log.
      input: {
        prompt: '',
        messages: [],
        metadata: { transport: 'stream', maxIterations: 5, enableTools: false },
      },
      working: {
        modelMessages: [],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    } as never);
  };

  const recordTaskFact = (threadId: string, text: string) => {
    recordSessionEvents(threadId, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: `user_${threadId}`,
          message: {
            id: `user_${threadId}`,
            role: 'user',
            parts: [{ type: 'text', text }],
          } as never,
        },
      },
    ]);
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-retry-events-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'retry.db') });
    addWorkspace({ id: 'ws_retry', path: root, name: 'retry' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_retry', workspace_id: 'ws_retry' });
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('retryAndExecute recovers the original task from the session log when the row lost its input copy', async () => {
    seedRun('run_failed_e1', 'thread_retry', 'failed');
    recordTaskFact('thread_retry', 'EVENT_RECOVERED_TASK_MARKER');
    const model = new FauxModelProvider([fauxText('recovered answer')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.retryAndExecute(target, 'run_failed_e1');

    expect(result).toMatchObject({ success: true, newRunId: expect.any(String) });
    expect(JSON.stringify(providerCalls.mock.calls[0][0].prompt)).toContain(
      'EVENT_RECOVERED_TASK_MARKER'
    );
  });

  it('a retry excludes the dead turn’s own committed output and re-runs the original task', async () => {
    seedRun('run_failed_e2', 'thread_retry', 'failed');
    recordTaskFact('thread_retry', 'PARTIAL_TASK_MARKER');
    // The turn committed a partial answer before it failed (F1 discipline:
    // committed facts survive the failure). The log keeps them — display and
    // replay show the whole story — but the retried request re-runs the
    // ORIGINAL task from the conversation before the turn, so the dead run's
    // partial does not leak into it. (The pre-existing double-effect question
    // for committed tool effects is ledgered in #134, not changed here.)
    recordSessionEvents('thread_retry', [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_failed_e2',
          messageId: 'assistant_partial',
          message: {
            id: 'assistant_partial',
            role: 'assistant',
            parts: [{ type: 'text', text: 'PARTIAL_PROGRESS_TEXT', state: 'done' }],
          } as never,
          transport: 'stream',
        },
      },
    ]);
    const model = new FauxModelProvider([fauxText('retried answer')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.retryAndExecute(target, 'run_failed_e2');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const requestPrompt = JSON.stringify(providerCalls.mock.calls[0][0].prompt);
    expect(requestPrompt).toContain('PARTIAL_TASK_MARKER');
    expect(
      requestPrompt,
      'the dead run’s own partial must not ride the retried request'
    ).not.toContain('PARTIAL_PROGRESS_TEXT');
    // The log still tells the whole story.
    const replay = rebuildThreadViewFromEvents('thread_retry');
    expect(JSON.stringify(replay.messages)).toContain('PARTIAL_PROGRESS_TEXT');
  });

  it('resumeRun executes a queued run whose row lost its input copy from the recorded facts', async () => {
    seedRun('run_queued_e1', 'thread_retry', 'queued');
    recordTaskFact('thread_retry', 'QUEUED_EVENT_TASK_MARKER');
    const model = new FauxModelProvider([fauxText('queued answer')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.resumeRun(target, 'run_queued_e1');

    expect(result).toMatchObject({ success: true });
    expect(JSON.stringify(providerCalls.mock.calls[0][0].prompt)).toContain(
      'QUEUED_EVENT_TASK_MARKER'
    );
  });

  it('a two-step retry (queued row created first) excludes the failed parent’s output', async () => {
    // The daemon flow: retryRun creates the queued successor, the resume
    // happens later. The queued row never records facts under its own id —
    // the dead output lives under the parent, and THAT is what the resume
    // must exclude.
    seedRun('run_failed_p', 'thread_retry', 'failed');
    recordTaskFact('thread_retry', 'TWOSTEP_TASK_MARKER');
    recordSessionEvents('thread_retry', [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_failed_p',
          messageId: 'assistant_parent_partial',
          message: {
            id: 'assistant_parent_partial',
            role: 'assistant',
            parts: [{ type: 'text', text: 'PARENT_PARTIAL_TEXT', state: 'done' }],
          } as never,
          transport: 'stream',
        },
      },
    ]);
    agentRunDb.createAgentRun({
      id: 'run_queued_child',
      kind: 'chat-turn',
      status: 'queued',
      threadId: 'thread_retry',
      parentRunId: 'run_failed_p',
      rootRunId: 'run_failed_p',
      providerType: 'openai',
      model: 'resume-model',
      systemPrompt: 'resume system',
      enabledTools: [],
      availableSkillIds: [],
      input: { prompt: '', messages: [], metadata: {} },
      working: {
        modelMessages: [],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    } as never);

    const model = new FauxModelProvider([fauxText('two-step answer')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.resumeRun(target, 'run_queued_child');

    if (!result.success) throw new Error(`resume failed: ${JSON.stringify(result)}`);
    const requestPrompt = JSON.stringify(providerCalls.mock.calls[0][0].prompt);
    expect(requestPrompt).toContain('TWOSTEP_TASK_MARKER');
    expect(requestPrompt).not.toContain('PARENT_PARTIAL_TEXT');
  });

  it('a wake run whose log has no recorded input facts refuses instead of re-running the wrong task', async () => {
    // Wake/task sends are id-less ModelMessages: rows written before the
    // input-facts slice (#139) recorded no input_accepted fact, so the replay
    // cannot reconstruct their task. The kind is admitted for retry since
    // #139, but the missing-facts refusal keeps the same guarantee — the
    // unguarded flip silently answered the thread's last CHAT message under
    // the wake's plan; this refuses loudly instead.
    agentRunDb.createAgentRun({
      id: 'run_wake_1',
      kind: 'awaiter-wake',
      status: 'failed',
      threadId: 'thread_retry',
      rootRunId: 'run_wake_1',
      providerType: 'openai',
      model: 'resume-model',
      systemPrompt: 'resume system',
      enabledTools: [],
      availableSkillIds: [],
      input: { prompt: 'WAKE_TASK_MARKER', messages: [{ role: 'user', content: 'WAKE_TASK_MARKER' }], metadata: {} },
      working: {
        modelMessages: [{ role: 'user', content: 'WAKE_TASK_MARKER' }],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    } as never);
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('must not run')]));

    const result = await service.retryAndExecute(target, 'run_wake_1');

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('no recorded session facts ending in its task');
    expect(createModelMock).not.toHaveBeenCalled();
    // The stale row copy would have "worked" — proving the flip took the
    // loud path, not the silent one.
    expect(
      agentRunDb.listAgentRunsByThread('thread_retry').find(run => run.status === 'queued')
    ).toBeUndefined();
  });

  it('a replay that does not end with the recorded task refuses before creating a successor row', async () => {
    // A handoff-chained failure: the child's committed output survives the
    // parent-only exclusion, so the replay ends assistant — no task to
    // re-run. Chain attribution is a later design; today this refuses
    // cleanly instead of streaming a promptless turn.
    seedRun('run_failed_h', 'thread_retry', 'failed');
    recordTaskFact('thread_retry', 'CHAIN_TASK_MARKER');
    recordSessionEvents('thread_retry', [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_failed_h_child',
          messageId: 'assistant_child',
          message: {
            id: 'assistant_child',
            role: 'assistant',
            parts: [{ type: 'text', text: 'CHILD_TEXT', state: 'done' }],
          } as never,
          transport: 'stream',
        },
      },
    ]);
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('must not run')]));

    const result = await service.retryAndExecute(target, 'run_failed_h');

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('ending in its task');
    expect(createModelMock).not.toHaveBeenCalled();
    expect(
      agentRunDb.listAgentRunsByThread('thread_retry').find(run => run.status === 'queued')
    ).toBeUndefined();
  });

  it('a run with neither a row input copy nor recorded facts refuses loudly', async () => {
    seedRun('run_failed_e3', 'thread_retry', 'failed');
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('must not run')]));

    const result = await service.retryAndExecute(target, 'run_failed_e3');

    expect(result.success).toBe(false);
    expect(createModelMock).not.toHaveBeenCalled();
    // No orphan queued row beside the refused retry.
    expect(
      agentRunDb.listAgentRunsByThread('thread_retry').find(run => run.status === 'queued')
    ).toBeUndefined();
    // Sanity: the refusal came from the missing recovery input, not the
    // stream's empty-prompt guard after a real attempt.
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM session_events').get()).toMatchObject({
      n: 0,
    });
  });
});
