// @vitest-environment node

/**
 * Issue #139: id-less wake/task sends record their accepted input as a
 * session fact — a deterministic per-turn id, the run id, and the caller's
 * system config — and the retry path re-runs the recorded TASK. The kind
 * gate opens proactive-task/awaiter-wake for retryAndExecute only (a blocked
 * task row recovers via the approval flow, not a handoff-resume); the
 * successor keeps the original kind; continuation kinds and delegated-agent
 * keep refusing.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const callPiChatMock = vi.hoisted(() => vi.fn());
const generateSingleShotMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
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
  createModel: createModelMock,
  // The send path's TOOL-LESS branch generates through the factory's
  // single-shot entry (not createModel) — mock it so the turn neither dials
  // the provider base_url nor depends on the streaming seam.
  generateChatWithModelMessages: generateSingleShotMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // These suites verify DURABLE behaviour (effect-aware retry, cancel routing,
  // handoff facts, inline journaling) using a scripted AI SDK model. They are
  // not about supply routing, so they pin the AI SDK harness explicitly: Pi
  // claims every provider type now, and a stubbed `createModel` would never be
  // reached. Routing itself is covered by factory_pi_generation.test.ts and
  // turn_supply_selection.test.ts.
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

  const taskSend = (threadId: string, kind: 'proactive-task' | 'awaiter-wake') =>
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
    kind: 'proactive-task' | 'delegated-agent' | 'handoff-resume'
  ) => {
    agentRunDb.createAgentRun({
      id: runId,
      kind,
      status: kind === 'proactive-task' ? 'blocked' : 'failed',
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
    // These suites drive the DURABLE layer (streaming, approvals, session-log
    // facts, retry, persistence) with a scripted AI SDK model. They are not about
    // which supply serves the turn, so they opt into the legacy executor: the
    // production default refuses a turn its projection cannot carry, and a
    // scripted model has no endpoint to project to.
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
    const result = (await taskSend('thread_task139', 'proactive-task')) as { runId?: string };
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
    // The fact id is deterministic per turn attempt and carries the run id.
    expect(payload.messageId).toBe(`input_${result.runId}`);
    const started = view.events.find(event => event.type === TURN_STARTED);
    expect((started!.payload as { kind?: string }).kind).toBe('proactive-task');
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

  it('a failed proactive-task run retries as a proactive-task run of the recorded task', async () => {
    generateSingleShotMock.mockRejectedValueOnce(new Error('provider down'));
    const failed = (await taskSend('thread_retry139', 'proactive-task')) as { runId?: string };
    expect(failed).toMatchObject({ success: false, runId: expect.any(String) });
    const failedRunId = failed.runId!;
    expect(agentRunDb.getAgentRun(failedRunId)).toMatchObject({
      status: 'failed',
      kind: 'proactive-task',
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

    // Attribution: the successor row and the replayed turn keep the kind.
    expect(agentRunDb.getAgentRun(retry.newRunId!)).toMatchObject({
      kind: 'proactive-task',
      status: 'completed',
    });

    // The re-run IS the recorded task: prompt and system config both ride.
    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(wire).toContain(TASK_TEXT);
    expect(wire).toContain(TASK_SYSTEM);

    const view = rebuildThreadViewFromEvents('thread_retry139');
    const completedKinds = view.turns
      .filter(turn => turn.status === 'completed')
      .map(turn => turn.kind);
    expect(completedKinds).toContain('proactive-task');
    // One input fact only — the retry consumes the recorded one, it does not
    // re-record (the replay history it re-enters with is id-less).
    expect(view.events.filter(event => event.type === INPUT_ACCEPTED)).toHaveLength(1);
  });

  it('resumeRun still refuses wake/task rows — blocked task rows recover via the approval flow', async () => {
    seedRun('run_blocked_139', 'thread_refuse139', 'proactive-task');
    seedInputFact('thread_refuse139', TASK_TEXT);
    const result = await service.resumeRun(target, 'run_blocked_139');
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('session-log resume is admitted');
  });

  it('delegated-agent and handoff-resume retries still refuse', async () => {
    seedRun('run_delegated_139', 'thread_refuse139', 'delegated-agent');
    seedInputFact('thread_refuse139', TASK_TEXT);
    const delegated = await service.retryAndExecute(target, 'run_delegated_139');
    expect(delegated).toMatchObject({ success: false });
    expect(delegated.error).toContain('session-log resume is admitted');

    seedRun('run_handoff_139', 'thread_refuse139', 'handoff-resume');
    const handoff = await service.retryAndExecute(target, 'run_handoff_139');
    expect(handoff).toMatchObject({ success: false });
    expect(handoff.error).toContain('session-log resume is admitted');
  });

  it('a retry whose replay tail was recorded for a LATER send refuses instead of re-running the wrong task', async () => {
    // #139 review: run A fails before committing output, the runner re-sends
    // (run B) which ALSO fails before committing — the replay's tail input
    // fact is B's. Retrying A must not re-run B's task under A's plan; the
    // tail fact's runId joins against the retried run's ancestry.
    generateSingleShotMock.mockRejectedValueOnce(new Error('provider down'));
    const failedA = (await taskSend('thread_retry139', 'proactive-task')) as { runId?: string };
    expect(failedA).toMatchObject({ success: false });
    const runAId = failedA.runId!;

    generateSingleShotMock.mockRejectedValueOnce(new Error('provider still down'));
    await taskSend('thread_retry139', 'proactive-task');

    const retryA = await service.retryAndExecute(target, runAId);
    expect(retryA).toMatchObject({ success: false });
    expect(retryA.error).toContain("the replay's tail input was recorded for run");
  });

  it('a retried successor passes the attribution join through its ancestry', async () => {
    // The successor's tail input fact carries the ORIGINAL run's id (a retry
    // re-enters with id-less messages and records no new fact) — the join
    // walks the parentRunId chain, so retrying the FAILED successor is the
    // same task, not a mismatch.
    generateSingleShotMock.mockRejectedValueOnce(new Error('provider down'));
    const failed = (await taskSend('thread_retry139', 'proactive-task')) as { runId?: string };
    const runAId = failed.runId!;

    // The first retry executes through the STREAMING path (createModel) and
    // fails before committing anything.
    createModelMock.mockImplementationOnce(() => {
      throw new Error('still down');
    });
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
    expect(agentRunDb.getAgentRun(secondRetry.newRunId!)).toMatchObject({ kind: 'proactive-task' });
  });

  it('the system-prompt binding follows the LAST input fact and resets on malformed data', () => {
    // Reducer-level pin (#139 review): a later chat input (no system field)
    // resets the binding — a task input's config must never leak onto a
    // later chat recovery; a malformed array resets to none, never partial.
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
      runConfig: { kind: 'proactive-task' },
    });
    const view = rebuildThreadViewFromEvents('thread_unrepr139');
    expect(view.events.filter(event => event.type === INPUT_ACCEPTED)).toHaveLength(0);
    // The turn still ran (and started recording its other facts).
    expect(view.events.some(event => event.type === TURN_STARTED)).toBe(true);
  });
});
