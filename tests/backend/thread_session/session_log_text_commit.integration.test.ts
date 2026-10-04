// @vitest-environment node

import fs from 'node:fs/promises';
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

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import {
  rebuildThreadViewFromEvents,
  MODEL_TEXT_COMMITTED,
  MODEL_OUTPUT_COMMITTED,
} from '@iki/backend/thread_session/session_log';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

const preparedTurn = {
  report: { totalEstimatedTokens: 1, blocks: [] },
  usedSkills: [],
  selectedSkillIds: [],
  skillMode: 'manual' as const,
  finalMessages: [{ role: 'user' as const, content: 'probe' }],
  history: [] as unknown[],
  prompt: 'probe',
  guardActive: false,
  requireApproval: false,
  autoApproveToolRequests: false,
  affectSignal: null,
  interventionPolicy: null,
  guardedTools: ['text_commit_probe'],
  enableTools: true,
};

// Stage C slice 3 (D22): streamed text is committed to the session log
// BEFORE it is published to the subscriber — everything shown is already in
// the log, so a crash can lose at most the unpublished buffer tail, never
// shown content. The cut-point regression drives a real turn and kills it
// mid-flight; the rebuild from events alone must match what was published.
describe('streamed text commit gate', () => {
  let dataDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;

  const publishedTextChunks = (target: { send: ReturnType<typeof vi.fn> }): string[] =>
    target.send.mock.calls
      .filter(
        call => call[0] === 'chat:ui-chunk' && (call[1] as { type: string }).type === 'text-delta'
      )
      .map(call => (call[1] as { delta?: string }).delta ?? '');

  const committedTextConcat = (threadId: string): string =>
    rebuildThreadViewFromEvents(threadId)
      .events.filter(event => event.type === MODEL_TEXT_COMMITTED)
      .map(event => (event.payload as { text: string }).text)
      .join('');

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-text-commit-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'commit.db') });
    conversation = createChatPersistence({
      memory: memory as never,
      // platform is module-mocked above; the real continuity hook is not
      // under test here, so the port gets a no-op double.
      onContinuityMessagePersisted: async () => undefined,
    });
    conversation.createThread({ id: 'thread_commit' });
    conversation.createThread({ id: 'thread_commit_kill' });
    conversation.createThread({ id: 'thread_commit_writereject' });
    defaultToolRegistry.register(
      createTool({
        name: 'text_commit_probe',
        type: 'function',
        description: 'Probe',
        paramSchema: z.object({}),
        handler: async () => 'observed',
      })
    );
  });

  afterAll(async () => {
    defaultToolRegistry.remove('text_commit_probe');
    closeDatabase();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // reset (not clear): leftover mockReturnValueOnce queues from a previous
    // test would leak providers and preparer fixtures across tests.
    vi.resetAllMocks();
    prepareChatTurnMock.mockResolvedValue(preparedTurn);
  });

  it('commits every published text delta — the log covers the whole shown text', async () => {
    // One model drives the whole conversation: the SDK's inner loop pops one
    // response per step — tool call (with lead-in text), then the follow-up
    // text. A tool boundary lands between the two committed segments.
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall('text_commit_probe', {}, { id: 'call_commit', textBefore: 'first segment. ' }),
        fauxText('second segment.'),
      ])
    );
    const target = { id: 101, send: vi.fn() };
    const streaming = createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Commit',
    });

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_commit',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_commit_1', role: 'user', parts: [{ type: 'text', text: 'probe' }] }],
      tools: ['text_commit_probe'],
    });
    expect(result).toMatchObject({ success: true });

    // Invariant: shown text ⊆ committed text — the published deltas and the
    // committed events carry exactly the same characters.
    const published = publishedTextChunks(target).join('');
    expect(published).toContain('first segment.');
    expect(published).toContain('second segment.');
    expect(committedTextConcat('thread_commit')).toBe(published);

    // The rebuild from events alone reproduces the full shown text.
    const view = rebuildThreadViewFromEvents('thread_commit');
    const assistant = view.messages.at(-1)!;
    expect(JSON.stringify(assistant.parts)).toContain('first segment.');
    expect(JSON.stringify(assistant.parts)).toContain('second segment.');
  });

  it('withholds streamed text when the session-log WRITE fails — shown ⊆ committed survives write rejection', async () => {
    // Rereview G1: the publish-failure path was covered; the WRITE-failure
    // path was not. An independent SQLite trigger refuses
    // model_text_committed inserts — the real driver must not publish text
    // it could not commit, and must not count the cleared buffer as
    // committed.
    const db = getDb();
    db.exec(
      `CREATE TRIGGER reject_text_commit
       BEFORE INSERT ON session_events
       WHEN NEW.type = 'model_text_committed'
       BEGIN SELECT RAISE(ABORT, 'write rejected'); END;`
    );
    try {
      createModelMock.mockReturnValue(new FauxModelProvider([fauxText('UNCOMMITTED_REVIEW_TEXT')]));
      const target = { id: 103, send: vi.fn() };
      const streaming = createChatStreaming({
        streamCoordinator: createThreadStreamCoordinator(),
        memory: memory as never,
        conversation: conversation as never,
        usage: { recordUsageEvent: vi.fn() },
        approvals: {
          ensurePendingApprovalSession: vi.fn(),
          registerApprovalBatch: vi.fn(),
          cleanupPendingSessionsForSender: vi.fn(),
        },
        getThreadTitle: () => 'Commit',
      });

      const result = await streaming.stream(target, {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'test-model',
        threadId: 'thread_commit_writereject',
        approvalPolicy: 'never',
        messages: [{ id: 'msg_commit_3', role: 'user', parts: [{ type: 'text', text: 'probe' }] }],
        tools: [],
      });
      expect(result).toMatchObject({ success: false });

      // The invariant is about what the subscriber SAW: nothing may be
      // published that the log does not hold.
      const published = publishedTextChunks(target).join('');
      expect(published).not.toContain('UNCOMMITTED_REVIEW_TEXT');
      expect(committedTextConcat('thread_commit_writereject')).toBe(published);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS reject_text_commit');
    }
  });

  it('at a mid-turn kill the rebuild matches exactly what was published', async () => {
    let killStreaming: ReturnType<typeof createChatStreaming> | null = null;
    defaultToolRegistry.register(
      createTool({
        name: 'text_commit_kill',
        type: 'function',
        description: 'Probe (kills the turn)',
        paramSchema: z.object({}),
        handler: async () => {
          // The crash: the user stops the turn while it is running.
          killStreaming?.stopStream(102);
          return 'observed';
        },
      })
    );
    prepareChatTurnMock.mockResolvedValueOnce({
      ...preparedTurn,
      guardedTools: ['text_commit_kill'],
    });
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall('text_commit_kill', {}, { id: 'call_kill', textBefore: 'shown before the kill. ' }),
      ])
    );
    killStreaming = createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Commit',
    });

    const killTarget = { id: 102, send: vi.fn() };
    const result = await killStreaming.stream(killTarget, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_commit_kill',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_commit_2', role: 'user', parts: [{ type: 'text', text: 'probe' }] }],
      tools: ['text_commit_kill'],
    });
    expect(result).toMatchObject({ success: true, stopped: true });

    // Crash cut: the events alone rebuild exactly the published prefix. The
    // kill settles through the normal cancelled path; the boundary flush had
    // already committed the shown text before the tool ran.
    const view = rebuildThreadViewFromEvents('thread_commit_kill');
    expect(view.turns.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(committedTextConcat('thread_commit_kill')).toBe('shown before the kill. ');
    const committedRow = view.events
      .filter(event => event.type === MODEL_OUTPUT_COMMITTED)
      .map(event => JSON.stringify((event.payload as { message: { parts: unknown[] } }).message.parts))
      .join('');
    expect(committedRow).not.toContain('never shown');
    const killedMessage = view.messages.find(message =>
      JSON.stringify(message.parts).includes('shown before the kill.')
    );
    expect(killedMessage).toBeDefined();
    expect(JSON.stringify(killedMessage!.parts)).not.toContain('never shown');
  });
});
