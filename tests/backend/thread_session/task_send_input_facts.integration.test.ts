// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const generateSingleShotMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/ai/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/ai/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/core/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/core/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/ai/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/ai/provider/llm/factory')>()),
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

import { closeDatabase, initializeDatabase } from '@iki/store/database';
import { addProvider } from '@iki/store/providers';
import * as agentRunDb from '@iki/store/agent_runs';
import { addWorkspace } from '@iki/store/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import {
  INPUT_ACCEPTED,
  MESSAGES_TRUNCATED,
  TURN_STARTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';

const TASK_SYSTEM = 'WAKE_TASK_AGENT_SYSTEM_PROMPT_139';
const TASK_TEXT = 'E2E_TASK_139 run the weekly report';

describe('id-less wake/task sends record input facts and retry as their kind', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 3, send: vi.fn() };

  const taskSend = (threadId: string, kind: 'awaiter-wake') =>
    service.stream(target, {
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

  const scriptReply = (text: string) => {
    callPiChatMock.mockImplementation(
      createScriptedPiChat([[{ kind: 'text', text }, { kind: 'done', reason: 'stop' }]])
    );
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

  it('records the accepted input of an id-less send as a fact (run id + message)', async () => {
    scriptReply('task done');
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
    // The composed system prompt is not a fact about the accepted input: turn_prep
    // rebuilds it for whichever turn is starting, so a replay cannot send a stale copy
    // alongside the current one.
    expect(payload.system).toBeUndefined();
    expect(JSON.stringify(payload.message)).toContain(TASK_TEXT);
    expect(payload.messageId).toBe(`input_${result.runId}`);
    const started = view.events.find(event => event.type === TURN_STARTED);
    expect((started!.payload as { kind?: string }).kind).toBe('awaiter-wake');
  });

  it('records the same facts for an awaiter wake', async () => {
    scriptReply('awake');
    const result = (await taskSend('thread_wake139', 'awaiter-wake')) as { runId?: string };
    expect(result).toMatchObject({ success: true, runId: expect.any(String) });

    const view = rebuildThreadViewFromEvents('thread_wake139');
    const payload = view.events.find(event => event.type === INPUT_ACCEPTED)!.payload as {
      runId?: string;
      system?: string[];
    };
    expect(payload.runId).toBe(result.runId);
    expect(payload.system).toBeUndefined();
    const started = view.events.find(event => event.type === TURN_STARTED);
    expect((started!.payload as { kind?: string }).kind).toBe('awaiter-wake');
  });

  it('a failed awaiter-wake run retries as an awaiter-wake run of the recorded task', async () => {
    callPiChatMock.mockImplementationOnce(() => { throw new Error('provider down'); });
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
    // The retry replays the accepted input rather than accepting a new one, so
    // the thread keeps a single input fact.
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
    callPiChatMock.mockImplementationOnce(() => { throw new Error('provider down'); });
    const failedA = (await taskSend('thread_retry139', 'awaiter-wake')) as { runId?: string };
    expect(failedA).toMatchObject({ success: false });
    const runAId = failedA.runId!;

    callPiChatMock.mockImplementationOnce(() => { throw new Error('provider still down'); });
    await taskSend('thread_retry139', 'awaiter-wake');

    const retryA = await service.retryAndExecute(target, runAId);
    expect(retryA).toMatchObject({ success: false });
    expect(retryA.error).toContain("the replay's tail input was recorded for run");
  });

  it('a retried successor passes the attribution join through its ancestry', async () => {
    callPiChatMock.mockImplementationOnce(() => { throw new Error('provider down'); });
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

  it('the replay tail follows the LAST input fact, and moves back when it is truncated', () => {
    const inputFact = (messageId: string, runId: string, extra: Record<string, unknown> = {}) => ({
      type: INPUT_ACCEPTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        messageId,
        message: { id: messageId, role: 'user', parts: [{ type: 'text', text: messageId }] } as never,
        runId,
        ...extra,
      },
    });
    recordSessionEvents('thread_task139', [
      inputFact('input_task', 'run_task', { system: ['task persona'] }),
      inputFact('input_chat', 'run_chat'),
    ]);
    // The run of the newest input is what a resume is admitted against.
    expect(rebuildThreadViewFromEvents('thread_task139').inputRunId).toBe('run_chat');
    // A copy of the system prompt written by an older build is not replayed.
    expect(rebuildThreadViewFromEvents('thread_task139')).not.toHaveProperty('inputSystemPrompts');

    recordSessionEvents('thread_task139', [
      {
        type: MESSAGES_TRUNCATED,
        version: SESSION_EVENT_VERSION,
        payload: { afterMessageId: 'input_task', deletedMessageIds: ['input_chat'] },
      },
    ]);
    expect(rebuildThreadViewFromEvents('thread_task139').inputRunId).toBe('run_task');
  });

  it('an unrepresentable id-less input records no fact rather than a partial one', async () => {
    scriptReply('done');
    await service.stream(target, {
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
