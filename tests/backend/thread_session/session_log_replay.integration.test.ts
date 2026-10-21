// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const prepareChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    injectReasoningContentIntoMessages: vi.fn((messages: unknown[]) => messages),
    resolveModelCapability: async () => ({
      contextWindow: 100000,
      maxInputTokens: 98000,
      maxOutputTokens: 2000,
    }),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: prepareChatTurnMock,
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  // session_loop now consumes these three as named imports; the factory must
  // provide them or module linking fails even when the preparer is mocked out.
  getAssistantProfileContextMessage: () => '',
  retrieveRelevantContinuity: () => null,
  onMessagePersisted: async () => undefined,
  getCompanion: () => ({
    setChatPolicy: vi.fn(),
    setAffect: vi.fn(),
    beginThinking: vi.fn(),
    endThinking: vi.fn(),
    clearConversationPreview: vi.fn(),
    setConversationPreview: vi.fn(),
    notifyReplyComplete: vi.fn(),
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { getChatMessages } from '@iki/backend/db/chat_message';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { legacyTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import {
  rebuildThreadViewFromEvents,
  INPUT_ACCEPTED,
  TURN_STARTED,
  TOOL_EXECUTED,
  MODEL_TEXT_COMMITTED,
  MODEL_OUTPUT_COMMITTED,
  STEERING_INPUT_ACCEPTED,
  TURN_COMPLETED,
} from '@iki/backend/thread_session/session_log';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// Stage C slice 1: every streaming turn records its business facts — the
// accepted input, the frozen plan, the committed output, the terminal state —
// into the Session log, and the conversation view is rebuildable from those
// events ALONE, with zero model or tool invocations during the rebuild
// (acceptance items 1–2, seed coverage).
describe('session log turn facts and pure replay', () => {
  let dataDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;
  const preparedTurn = {
    report: { totalEstimatedTokens: 1, blocks: [] },
    usedSkills: [],
    selectedSkillIds: [],
    skillMode: 'manual' as const,
    finalMessages: [{ role: 'user' as const, content: 'run the probe' }],
    history: [] as unknown[],
    prompt: 'run the probe',
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    affectSignal: null,
    interventionPolicy: null,
    guardedTools: ['replay_probe'],
    enableTools: true,
  };

  const buildStreaming = () =>
    createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Replay',
    });

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-session-log-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'log.db') });
    conversation = createChatPersistence({
      memory: memory as never,
      // platform is module-mocked above; the real continuity hook is not
      // under test here, so the port gets a no-op double.
      onContinuityMessagePersisted: async () => undefined,
    });
    conversation.createThread({ id: 'thread_log' });
    conversation.createThread({ id: 'thread_steer' });
    defaultToolRegistry.register(
      createTool({
        name: 'replay_probe',
        type: 'function',
        description: 'Probe',
        paramSchema: z.object({}),
        handler: async () => ({ evidence: 'observed' }),
      })
    );
  });

  afterAll(async () => {
    defaultToolRegistry.remove('replay_probe');
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
  // These suites drive the DURABLE layer (streaming, approvals, session-log
  // facts, retry, persistence) with a scripted AI SDK model. They are not about
  // which supply serves the turn, so they opt into the legacy executor: the
  // production default refuses a turn its projection cannot carry, and a
  // scripted model has no endpoint to project to.
  setTurnHarnessFallback(legacyTurnHarness);
    vi.clearAllMocks();
    prepareChatTurnMock.mockResolvedValue(preparedTurn);
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall('replay_probe', {}, { id: 'call_log_1' }),
        fauxText('probe done'),
      ])
    );
  });

  it('records a steering input as a session-log fact (H6)', async () => {
    // A steering input reaches the model's NEXT prompt (the driver splices it
    // into streamHistory) and must ALSO be recorded as a session-log fact.
    // Before the fix the log held only the original INPUT_ACCEPTED, so a
    // recovery replay could not see that the human ever steered: the two
    // projections of one conversation disagreed.
    const coordinator = createThreadStreamCoordinator();
    const stream = createChatStreaming({
      streamCoordinator: coordinator,
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Replay',
    });

    const faux = new FauxModelProvider([
      fauxToolCall('replay_probe', {}, { id: 'call_steer_1' }),
      fauxText('interrupted'),
      fauxText('steered response'),
    ]);
    createModelMock.mockReturnValue(faux);
    const original = faux.doStream.bind(faux);
    let calls = 0;
    const spy = vi.spyOn(faux, 'doStream').mockImplementation(options => {
      calls += 1;
      if (calls === 2) coordinator.steerStream(83, 'thread_steer', 'change course');
      return original(options);
    });

    const result = await stream.stream({ id: 83, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_steer',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_steer_1', role: 'user', parts: [{ type: 'text', text: 'run the probe' }] }],
      tools: ['replay_probe'],
      autonomous: { maxIterations: 3 },
    });
    const lastPrompt = JSON.stringify(spy.mock.calls.at(-1)?.[0]?.prompt ?? []);
    spy.mockRestore();

    // The steering text DID reach the model — the bug is not that steering
    // fails, it is that the log never records it.
    expect(lastPrompt).toContain('change course');
    expect(result).toMatchObject({ success: true });

    // The steering input is now a recorded fact, so a replay reconstructs
    // what the human asked for mid-turn.
    const view = rebuildThreadViewFromEvents('thread_steer');
    const inputFacts = view.events
      .filter(event => event.type === INPUT_ACCEPTED || event.type === STEERING_INPUT_ACCEPTED)
      .map(event => JSON.stringify((event as { payload?: unknown }).payload ?? ''));
    expect(inputFacts.join(' ')).toContain('run the probe');
    expect(inputFacts.join(' ')).toContain('change course');

    // The fact must also reach the rebuilt CONVERSATION, not just the event
    // stream: recovery consumers derive history from view.messages, so a fact
    // with no reducer arm would still leave the steer invisible to them.
    expect(JSON.stringify(view.messages)).toContain('change course');
  });

  it('records the turn facts and rebuilds the view from events alone', async () => {
    const streaming = buildStreaming();
    const result = await streaming.stream({ id: 81, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_log',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_log_1', role: 'user', parts: [{ type: 'text', text: 'run the probe' }] }],
      tools: ['replay_probe'],
    });
    expect(result).toMatchObject({ success: true, text: 'probe done' });

    // The live serving row exists (legacy authority, unchanged).
    expect(getChatMessages('thread_log').map(row => row.id)).toContain('msg_log_1');

    // Rebuild with the model factory rigged to explode: the replay must not
    // invoke it (acceptance item 2 — rebuilding calls nothing). The mock is
    // cleared first so the turn's own legitimate call does not count.
    createModelMock.mockClear();
    createModelMock.mockImplementation(() => {
      throw new Error('replay must not call the model');
    });
    const view = rebuildThreadViewFromEvents('thread_log');
    expect(createModelMock).not.toHaveBeenCalled();

    // Event order: input → start → the inline tool effect (issue #145) →
    // committed text → committed output → terminal. The streamed answer
    // goes through the D22 commit gate.
    expect(view.events.map(event => event.type)).toEqual([
      INPUT_ACCEPTED,
      TURN_STARTED,
      TOOL_EXECUTED,
      MODEL_TEXT_COMMITTED,
      MODEL_OUTPUT_COMMITTED,
      TURN_COMPLETED,
    ]);

    // The conversation view: the user input and the final assistant message.
    expect(view.messages.map(message => message.id)).toEqual(['msg_log_1', expect.stringMatching(/^assistant_/)]);
    const [user, assistant] = view.messages;
    expect(user!.role).toBe('user');
    expect(assistant!.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'call_log_1', state: 'output-available' }),
        expect.objectContaining({ type: 'text' }),
      ])
    );

    // The turn record: identity, plan facts, terminal status.
    expect(view.turns).toHaveLength(1);
    expect(view.turns[0]).toMatchObject({ status: 'completed', kind: 'chat-turn' });
    const startedPayload = view.events.find(event => event.type === TURN_STARTED)!
      .payload as { plan: { model: string; enabledTools: string[] } };
    expect(startedPayload.plan).toMatchObject({
      model: 'test-model',
      enabledTools: ['replay_probe'],
    });
  });

  it('records the terminal failure when the provider errors and the row stays honest', async () => {
    createModelMock.mockImplementation(() => {
      throw new Error('provider exploded');
    });
    const streaming = buildStreaming();
    const result = await streaming.stream({ id: 83, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_log',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_log_fail', role: 'user', parts: [{ type: 'text', text: 'explode' }] }],
      tools: ['replay_probe'],
    });
    expect(result).toMatchObject({ success: false });

    const view = rebuildThreadViewFromEvents('thread_log');
    const failedTurn = view.turns.find(turn => turn.status === 'failed');
    expect(failedTurn).toBeDefined();
    expect(failedTurn!.errorText).toContain('provider exploded');
    // No phantom committed output: the failure persisted no assistant row
    // and recorded no committed event.
    expect(
      view.events.some(
        event =>
          event.type === MODEL_OUTPUT_COMMITTED &&
          (event.payload as { runId: string }).runId === failedTurn!.runId
      )
    ).toBe(false);
  });

  it('continues the same stream across a follow-up turn', async () => {
    const streaming = buildStreaming();
    const result = await streaming.stream({ id: 82, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_log',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_log_2', role: 'user', parts: [{ type: 'text', text: 'again' }] }],
      tools: ['replay_probe'],
    });
    expect(result).toMatchObject({ success: true });

    const view = rebuildThreadViewFromEvents('thread_log');
    // One stream across turns (earlier tests recorded theirs too); the new
    // input and output joined the view and the turn completed.
    expect(view.turns.filter(turn => turn.status === 'completed').length).toBeGreaterThanOrEqual(2);
    expect(view.messages.map(message => message.id)).toContain('msg_log_2');
    expect(view.messages.filter(message => message.id === 'msg_log_1')).toHaveLength(1);
    const revisions = view.events.map(event => event.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
  });

  it('deletes the stream with its conversation', async () => {
    // The shared stream carries facts from the earlier tests; deleting the
    // conversation must take every one of them with it.
    const { deleteChatThread } = await import('@iki/backend/db/chat_thread');
    expect(rebuildThreadViewFromEvents('thread_log').events.length).toBeGreaterThan(0);
    deleteChatThread('thread_log');
    const view = rebuildThreadViewFromEvents('thread_log');
    expect(view.events).toEqual([]);
    expect(view.messages).toEqual([]);
    expect(view.turns).toEqual([]);
  });
});
