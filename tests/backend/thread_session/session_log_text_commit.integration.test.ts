// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const prepareChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
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
  getAssistantProfileContextMessage: () => '',
  getCompanion: () => ({
    beginThinking: vi.fn(),
    endThinking: vi.fn(),
    clearConversationPreview: vi.fn(),
    setConversationPreview: vi.fn(),
    notifyReplyComplete: vi.fn(),
  }),
}));

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import {
  rebuildThreadViewFromEvents,
  MODEL_TEXT_COMMITTED,
  MODEL_OUTPUT_COMMITTED,
} from '@iki/backend/thread_session/session_log';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';

const memory = {
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
    seedTurnProvider({ providerId: 'provider_primary', model: 'test-model' });
    conversation = createChatPersistence({
      memory: memory as never,
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
    setTurnHarnessFallback(piTurnHarness);
    vi.resetAllMocks();
    prepareChatTurnMock.mockResolvedValue(preparedTurn);
  });

  it('commits every published text delta — the log covers the whole shown text', async () => {
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'first segment. ' },
          { kind: 'toolCall', toolName: 'text_commit_probe', args: {}, id: 'call_commit' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'second segment.' },
          { kind: 'done', reason: 'stop' },
        ],
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

    const published = publishedTextChunks(target).join('');
    expect(published).toContain('first segment.');
    expect(published).toContain('second segment.');
    expect(committedTextConcat('thread_commit')).toBe(published);

    const view = rebuildThreadViewFromEvents('thread_commit');
    const assistant = view.messages.at(-1)!;
    expect(JSON.stringify(assistant.parts)).toContain('first segment.');
    expect(JSON.stringify(assistant.parts)).toContain('second segment.');
  });

  it('withholds streamed text when the session-log WRITE fails — shown ⊆ committed survives write rejection', async () => {
    const db = getDb();
    db.exec(
      `CREATE TRIGGER reject_text_commit
       BEFORE INSERT ON session_events
       WHEN NEW.type = 'model_text_committed'
       BEGIN SELECT RAISE(ABORT, 'write rejected'); END;`
    );
    try {
      callPiChatMock.mockImplementation(
        createScriptedPiChat([
          [{ kind: 'text', text: 'UNCOMMITTED_REVIEW_TEXT' }, { kind: 'done' }],
        ])
      );
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
          killStreaming?.stopStream(102);
          return 'observed';
        },
      })
    );
    prepareChatTurnMock.mockResolvedValueOnce({
      ...preparedTurn,
      guardedTools: ['text_commit_kill'],
    });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'shown before the kill. ' },
          { kind: 'toolCall', toolName: 'text_commit_kill', args: {}, id: 'call_kill' },
          { kind: 'done', reason: 'toolUse' },
        ],
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

    const view = rebuildThreadViewFromEvents('thread_commit_kill');
    expect(view.turns.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(committedTextConcat('thread_commit_kill')).toBe('shown before the kill. ');
    const committedRow = view.events
      .filter(event => event.type === MODEL_OUTPUT_COMMITTED)
      .map(event =>
        JSON.stringify((event.payload as { message: { parts: unknown[] } }).message.parts)
      )
      .join('');
    expect(committedRow).not.toContain('never shown');
    const killedMessage = view.messages.find(message =>
      JSON.stringify(message.parts).includes('shown before the kill.')
    );
    expect(killedMessage).toBeDefined();
    expect(JSON.stringify(killedMessage!.parts)).not.toContain('never shown');
  });
});
