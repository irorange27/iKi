// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const generateSingleShotMock = vi.hoisted(() => vi.fn());
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
  generateChatWithModelMessages: generateSingleShotMock,
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import {
  INPUT_ACCEPTED,
  TURN_STARTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';

const TASK_SYSTEM = 'WAKE_TASK_AGENT_SYSTEM_PROMPT_139';
const TASK_TEXT = 'E2E_TASK_139 run the weekly report';

describe('id-less wake/task sends record input facts and retry as their kind', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 3, send: vi.fn() };

  const taskSend = (threadId: string, kind: 'awaiter-wake') =>
    service.send({
      providerType: 'openai',
      model: 'resume-model',
      messages: [
        { role: 'system', content: TASK_SYSTEM },
        { role: 'user', content: TASK_TEXT },
      ],
      threadId,
      tools: [],
      runConfig: { kind, metadata: { source: kind, taskId: 'task_139' } },
    });

  const seedRun = (
    runId: string,
    threadId: string,
    kind: 'awaiter-wake' | 'delegated-agent'
  ) => {
    agentRunDb.createAgentRun({
      id: runId,
      kind,
      status: kind === 'awaiter-wake' ? 'blocked' : 'failed',
      threadId,
      rootRunId: runId,
      providerType: 'openai',
      model: 'resume-model',
      systemPrompt: 'seeded system',
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
  };

  const seedInputFact = (threadId: string, text: string) => {
    recordSessionEvents(threadId, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: `input_seed_${threadId}`,
          message: {
            id: `input_seed_${threadId}`,
            role: 'user',
            parts: [{ type: 'text', text }],
          } as never,
        },
      },
    ]);
  };

  const singleShotResult = (text: string) => ({
    text,
    usage: {
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
    },
  });

  beforeEach(async () => {
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-task-input-facts-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'task-facts.db') });
    addProvider({
      id: 'provider_primary',
      name: 'primary',
      type: 'openai',
      api_key: 'key-task139',
      models: '["resume-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addWorkspace({ id: 'ws_task139', path: root, name: 'task139' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_task139', workspace_id: 'ws_task139' });
    conversation.createThread({ id: 'thread_retry139', workspace_id: 'ws_task139' });
    conversation.createThread({ id: 'thread_wake139', workspace_id: 'ws_task139' });
    conversation.createThread({ id: 'thread_refuse139', workspace_id: 'ws_task139' });
    conversation.createThread({ id: 'thread_unrepr139', workspace_id: 'ws_task139' });
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('records the accepted input of an id-less send as a fact (run id + system config)', async () => {
    generateSingleShotMock.mockResolvedValue(singleShotResult('task done'));
    const result = (await taskSend('thread_task139', 'awaiter-wake')) as { runId?: string };
    expect(result).toMatchObject({ success: true, runId: expect.any(String) });

    const view = rebuildThreadViewFromEvents('thread_task139');
    const inputFacts = view.events.filter(event => event.type === INPUT_ACCEPTED);
    expect(inputFacts).toHaveLength(1);
    const payload = inputFacts[0].payload as {
      messageId?: string;
      runId?: string;
      system?: string[];
      message?: { parts?: Array<{ text?: string }> };
    };
    expect(payload.runId).toBe(result.runId);
    expect(payload.system).toEqual([TASK_SYSTEM]);
    expect(JSON.stringify(payload.message)).toContain(TASK_TEXT);
    expect(payload.messageId).toBe(`input_${result.runId}`);
    const started = view.events.find(event => event.type === TURN_STARTED);
    expect((started!.payload as { kind?: string }).kind).toBe('awaiter-wake');
  });

  it('records the same facts for an awaiter wake', async () => {
    generateSingleShotMock.mockResolvedValue(singleShotResult('awake'));
    const result = (await taskSend('thread_wake139', 'awaiter-wake')) as { runId?: string };
    expect(result).toMatchObject({ success: true, runId: expect.any(String) });

    const view = rebuildThreadViewFromEvents('thread_wake139');
    const payload = view.events.find(event => event.type === INPUT_ACCEPTED)!.payload as {
      runId?: string;
      system?: string[];
    };
    expect(payload.runId).toBe(result.runId);
    expect(payload.system).toEqual([TASK_SYSTEM]);
    const started = view.events.find(event => event.type === TURN_STARTED);
    expect((started!.payload as { kind?: string }).kind).toBe('awaiter-wake');
  });

  it('a failed awaiter-wake run retries as an awaiter-wake run of the recorded task', async () => {
    generateSingleShotMock.mockRejectedValueOnce(new Error('provider down'));
    const failed = (await taskSend('thread_retry139', 'awaiter-wake')) as { runId?: string };
    expect(failed).toMatchObject({ success: false, runId: expect.any(String) });
    const failedRunId = failed.runId!;
    expect(agentRunDb.getAgentRun(failedRunId)).toMatchObject({
      status: 'failed',
      kind: 'awaiter-wake',
    });

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'task retried ok' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const retry = (await service.retryAndExecute(target, failedRunId)) as { newRunId?: string };
    expect(retry).toMatchObject({ success: true, newRunId: expect.any(String) });

    expect(agentRunDb.getAgentRun(retry.newRunId!)).toMatchObject({
      kind: 'awaiter-wake',
      status: 'completed',
    });

    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(wire).toContain(TASK_TEXT);
    expect(wire).toContain(TASK_SYSTEM);

    const view = rebuildThreadViewFromEvents('thread_retry139');
    const completedKinds = view.turns
      .filter(turn => turn.status === 'completed')
      .map(turn => turn.kind);
    expect(completedKinds).toContain('awaiter-wake');
    expect(view.events.filter(event => event.type === INPUT_ACCEPTED)).toHaveLength(1);
  });

  it('resumeRun still refuses wake/task rows — blocked task rows recover via the approval flow', async () => {
    seedRun('run_blocked_139', 'thread_refuse139', 'awaiter-wake');
    seedInputFact('thread_refuse139', TASK_TEXT);
    const result = await service.resumeRun(target, 'run_blocked_139');
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('session-log resume is admitted');
  });

  it('delegated-agent retries still refuse', async () => {
    seedRun('run_delegated_139', 'thread_refuse139', 'delegated-agent');
    seedInputFact('thread_refuse139', TASK_TEXT);
    const delegated = await service.retryAndExecute(target, 'run_delegated_139');
    expect(delegated).toMatchObject({ success: false });
    expect(delegated.error).toContain('session-log resume is admitted');
  });

  it('a retry whose replay tail was recorded for a LATER send refuses instead of re-running the wrong task', async () => {
    generateSingleShotMock.mockRejectedValueOnce(new Error('provider down'));
    const failedA = (await taskSend('thread_retry139', 'awaiter-wake')) as { runId?: string };
    expect(failedA).toMatchObject({ success: false });
    const runAId = failedA.runId!;

    generateSingleShotMock.mockRejectedValueOnce(new Error('provider still down'));
    await taskSend('thread_retry139', 'awaiter-wake');

    const retryA = await service.retryAndExecute(target, runAId);
    expect(retryA).toMatchObject({ success: false });
    expect(retryA.error).toContain("the replay's tail input was recorded for run");
  });

  it('a retried successor passes the attribution join through its ancestry', async () => {
    generateSingleShotMock.mockRejectedValueOnce(new Error('provider down'));
    const failed = (await taskSend('thread_retry139', 'awaiter-wake')) as { runId?: string };
    const runAId = failed.runId!;

    const firstRetry = (await service.retryAndExecute(target, runAId)) as { newRunId?: string };
    expect(firstRetry).toMatchObject({ success: false, newRunId: expect.any(String) });
    const successorId = firstRetry.newRunId!;

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'recovered' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const secondRetry = await service.retryAndExecute(target, successorId);
    expect(secondRetry).toMatchObject({ success: true, newRunId: expect.any(String) });
    expect(agentRunDb.getAgentRun(secondRetry.newRunId!)).toMatchObject({ kind: 'awaiter-wake' });
  });

  it('the system-prompt binding follows the LAST input fact and resets on malformed data', () => {
    recordSessionEvents('thread_task139', [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'input_task',
          message: {
            id: 'input_task',
            role: 'user',
            parts: [{ type: 'text', text: 'task' }],
          } as never,
          runId: 'run_task',
          system: ['task persona'],
        },
      },
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'input_chat',
          message: {
            id: 'input_chat',
            role: 'user',
            parts: [{ type: 'text', text: 'chat' }],
          } as never,
        },
      },
    ]);
    expect(rebuildThreadViewFromEvents('thread_task139').inputSystemPrompts).toEqual([]);

    recordSessionEvents('thread_task139', [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'input_malformed',
          message: {
            id: 'input_malformed',
            role: 'user',
            parts: [{ type: 'text', text: 'x' }],
          } as never,
          system: ['ok persona', 42],
        },
      },
    ]);
    expect(rebuildThreadViewFromEvents('thread_task139').inputSystemPrompts).toEqual([]);
  });

  it('an unrepresentable id-less input records no fact rather than a partial one', async () => {
    generateSingleShotMock.mockResolvedValue(singleShotResult('done'));
    await service.send({
      providerType: 'openai',
      model: 'resume-model',
      messages: [
        { role: 'system', content: TASK_SYSTEM },
        { role: 'user', content: [{ type: 'text', text: 'part-array task' }] } as never,
      ],
      threadId: 'thread_unrepr139',
      tools: [],
      runConfig: { kind: 'awaiter-wake' },
    });
    const view = rebuildThreadViewFromEvents('thread_unrepr139');
    expect(view.events.filter(event => event.type === INPUT_ACCEPTED)).toHaveLength(0);
    expect(view.events.some(event => event.type === TURN_STARTED)).toBe(true);
  });
});
