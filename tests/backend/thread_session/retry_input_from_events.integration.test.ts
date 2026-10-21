// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  MODEL_TEXT_COMMITTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';

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
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-retry-events-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'retry.db') });
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'test-model' });
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'recovered answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_failed_e1');

    expect(result).toMatchObject({ success: true, newRunId: expect.any(String) });
    expect(JSON.stringify(providerCalls.mock.calls[0][1])).toContain('EVENT_RECOVERED_TASK_MARKER');
  });

  it('a retry excludes the dead turn’s own committed output and re-runs the original task', async () => {
    seedRun('run_failed_e2', 'thread_retry', 'failed');
    recordTaskFact('thread_retry', 'PARTIAL_TASK_MARKER');
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'retried answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_failed_e2');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const requestPrompt = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(requestPrompt).toContain('PARTIAL_TASK_MARKER');
    expect(
      requestPrompt,
      'the dead run’s own partial must not ride the retried request'
    ).not.toContain('PARTIAL_PROGRESS_TEXT');
    const replay = rebuildThreadViewFromEvents('thread_retry');
    expect(JSON.stringify(replay.messages)).toContain('PARTIAL_PROGRESS_TEXT');
  });

  it('resumeRun executes a queued run whose row lost its input copy from the recorded facts', async () => {
    seedRun('run_queued_e1', 'thread_retry', 'queued');
    recordTaskFact('thread_retry', 'QUEUED_EVENT_TASK_MARKER');
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'queued answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.resumeRun(target, 'run_queued_e1');

    expect(result).toMatchObject({ success: true });
    expect(JSON.stringify(providerCalls.mock.calls[0][1])).toContain('QUEUED_EVENT_TASK_MARKER');
  });

  it('a two-step retry (queued row created first) excludes the failed parent’s output', async () => {
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

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'two-step answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.resumeRun(target, 'run_queued_child');

    if (!result.success) throw new Error(`resume failed: ${JSON.stringify(result)}`);
    const requestPrompt = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(requestPrompt).toContain('TWOSTEP_TASK_MARKER');
    expect(requestPrompt).not.toContain('PARENT_PARTIAL_TEXT');
  });

  it('a wake run whose log has no recorded input facts refuses instead of re-running the wrong task', async () => {
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
      input: {
        prompt: 'WAKE_TASK_MARKER',
        messages: [{ role: 'user', content: 'WAKE_TASK_MARKER' }],
        metadata: {},
      },
      working: {
        modelMessages: [{ role: 'user', content: 'WAKE_TASK_MARKER' }],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    } as never);
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const result = await service.retryAndExecute(target, 'run_wake_1');

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('no recorded session facts ending in its task');
    expect(
      agentRunDb.listAgentRunsByThread('thread_retry').find(run => run.status === 'queued')
    ).toBeUndefined();
  });

  it('a handoff-chained failure retries the original task with the whole dead chain excluded', async () => {
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
    agentRunDb.createAgentRun({
      id: 'run_failed_h_child',
      kind: 'chat-turn',
      status: 'failed',
      threadId: 'thread_retry',
      parentRunId: 'run_failed_h',
      rootRunId: 'run_failed_h',
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'chain retried' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_failed_h');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const requestPrompt = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(requestPrompt).toContain('CHAIN_TASK_MARKER');
    expect(requestPrompt).not.toContain('CHILD_TEXT');
  });

  it('a retry of a stacked failure excludes every dead attempt above and below it', async () => {
    seedRun('run_stack_a', 'thread_retry', 'failed');
    agentRunDb.createAgentRun({
      id: 'run_stack_b',
      kind: 'chat-turn',
      status: 'failed',
      threadId: 'thread_retry',
      parentRunId: 'run_stack_a',
      rootRunId: 'run_stack_a',
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
    recordTaskFact('thread_retry', 'STACK_TASK_MARKER');
    for (const runId of ['run_stack_a', 'run_stack_b']) {
      recordSessionEvents('thread_retry', [
        {
          type: MODEL_TEXT_COMMITTED,
          version: SESSION_EVENT_VERSION,
          payload: {
            runId,
            messageId: `assistant_${runId}`,
            seq: 0,
            text: `DEAD_ATTEMPT_TEXT_${runId}`,
          },
        },
      ]);
    }
    callPiChatMock.mockImplementation(() => {
      throw new Error('still failing');
    });
    const retryB = await service.retryAndExecute(target, 'run_stack_b');
    expect(retryB).toMatchObject({ success: false });
    expect(JSON.stringify(retryB)).not.toContain('ending in its task');

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'origin retried' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls2 = callPiChatMock;
    const retryA = await service.retryAndExecute(target, 'run_stack_a');
    if (!retryA.success) throw new Error(`retry A failed: ${JSON.stringify(retryA)}`);
    const promptA = JSON.stringify(providerCalls2.mock.calls[0][1]);
    expect(promptA).toContain('STACK_TASK_MARKER');
    expect(promptA).not.toContain('DEAD_ATTEMPT_TEXT_');
  });

  it('a succeeded turn is never treated as a dead attempt', async () => {
    seedRun('run_alive_a', 'thread_retry', 'failed');
    recordTaskFact('thread_retry', 'ALIVE_TASK_MARKER');
    recordSessionEvents('thread_retry', [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_alive_done',
          messageId: 'assistant_alive_done',
          message: {
            id: 'assistant_alive_done',
            role: 'assistant',
            parts: [{ type: 'text', text: 'ALREADY_DONE_TEXT', state: 'done' }],
          } as never,
          transport: 'stream',
        },
      },
    ]);
    agentRunDb.createAgentRun({
      id: 'run_alive_done',
      kind: 'chat-turn',
      status: 'completed',
      threadId: 'thread_retry',
      parentRunId: 'run_alive_a',
      rootRunId: 'run_alive_a',
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const result = await service.retryAndExecute(target, 'run_alive_a');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('ending in its task');
    expect(
      agentRunDb.listAgentRunsByThread('thread_retry').find(run => run.status === 'queued')
    ).toBeUndefined();
  });

  it('a succeeded ancestor keeps its output in the retried wake replay', async () => {
    agentRunDb.createAgentRun({
      id: 'run_wake_origin',
      kind: 'chat-turn',
      status: 'completed',
      threadId: 'thread_retry',
      rootRunId: 'run_wake_origin',
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
    recordSessionEvents('thread_retry', [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_wake_origin',
          messageId: 'assistant_origin',
          message: {
            id: 'assistant_origin',
            role: 'assistant',
            parts: [{ type: 'text', text: 'ORIGIN_LIVE_TEXT', state: 'done' }],
          } as never,
          transport: 'stream',
        },
      },
    ]);
    agentRunDb.createAgentRun({
      id: 'run_wake_child',
      kind: 'awaiter-wake',
      status: 'failed',
      threadId: 'thread_retry',
      parentRunId: 'run_wake_origin',
      rootRunId: 'run_wake_origin',
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
    recordSessionEvents('thread_retry', [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'input_run_wake_child',
          message: {
            id: 'input_run_wake_child',
            role: 'user',
            parts: [{ type: 'text', text: 'WAKE_RETRY_TASK' }],
          } as never,
          runId: 'run_wake_child',
        },
      },
    ]);
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'wake retried' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_wake_child');
    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(wire).toContain('WAKE_RETRY_TASK');
    expect(wire).toContain('ORIGIN_LIVE_TEXT');
  });

  it('a run with neither a row input copy nor recorded facts refuses loudly', async () => {
    seedRun('run_failed_e3', 'thread_retry', 'failed');
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const result = await service.retryAndExecute(target, 'run_failed_e3');

    expect(result.success).toBe(false);
    expect(
      agentRunDb.listAgentRunsByThread('thread_retry').find(run => run.status === 'queued')
    ).toBeUndefined();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM session_events').get()).toMatchObject({
      n: 0,
    });
  });
});
