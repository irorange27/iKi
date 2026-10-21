// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE SAFETY NET FOR THE PERSISTENCE CONVERGENCE (P0).
 *
 * ADR 008 declares `session_events` the only recovery authority and demotes
 * `chat_messages` to a rebuildable projection. Two independent stores of one
 * conversation can drift, and until they are compared mechanically the drift
 * is invisible: every existing suite asserts ONE side (the log in
 * session_log_replay, the rows in the message suites) and none asserts they
 * agree.
 *
 * This suite asserts the projection contract directly: for a conversation
 * produced by a REAL turn, the replay of the event stream must yield the same
 * user-visible conversation as the `chat_messages` rows. It is the gate that
 * makes every later deletion (P1 fail-closed, P2 removing the third copy)
 * safe to attempt: if a change makes one side lose a fact the other keeps,
 * this test fails instead of a user's conversation silently losing a message.
 *
 * Deliberately NOT asserted here: fields the two stores legitimately disagree
 * on (row-level timestamps, `metadata` blobs, depth/parent bookkeeping). The
 * contract is about what the HUMAN sees — message identity, role, text — and
 * about the tool parts, which is where the two writers have historically
 * diverged (issue #145's inline execution).
 */

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
  retrieveRelevantContinuity: () => null,
  onMessagePersisted: async () => undefined,
  getCompanion: () => ({
    beginThinking: vi.fn(),
    endThinking: vi.fn(),
    clearConversationPreview: vi.fn(),
    setConversationPreview: vi.fn(),
    notifyReplyComplete: vi.fn(),
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { getChatMessages } from '@iki/backend/db/chat_message';
import { parseStoredUiMessageRow } from '@iki/backend/message/ui_message_codec';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { piTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

/**
 * The comparable shape of a conversation. Reduces both stores to the facts a
 * human sees, so the assertion names the contract instead of a serialization.
 */
type ComparableMessage = {
  id: string;
  role: string;
  text: string;
  toolCallIds: string[];
};

const textOf = (message: ChatUiMessage): string =>
  (message.parts ?? [])
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('');

const toolCallIdsOf = (message: ChatUiMessage): string[] =>
  (message.parts ?? [])
    .map(part => (part as { toolCallId?: unknown }).toolCallId)
    .filter((id): id is string => typeof id === 'string')
    .sort();

const comparable = (message: ChatUiMessage): ComparableMessage => ({
  id: message.id,
  role: message.role,
  text: textOf(message),
  toolCallIds: toolCallIdsOf(message),
});

describe('projection equivalence: the event replay and the chat rows agree', () => {
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
    guardedTools: ['equivalence_probe'],
    enableTools: true,
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-projection-equivalence-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'equivalence.db') });
    seedTurnProvider({ providerId: 'provider_primary', model: 'test-model' });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: async () => undefined,
    });
    conversation.createThread({ id: 'thread_equivalence' });
    defaultToolRegistry.register(
      createTool({
        name: 'equivalence_probe',
        type: 'function',
        description: 'Probe',
        paramSchema: z.object({}),
        handler: async () => ({ evidence: 'observed' }),
      })
    );
  });

  afterAll(async () => {
    defaultToolRegistry.remove('equivalence_probe');
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    setTurnHarnessFallback(piTurnHarness);
    vi.clearAllMocks();
    prepareChatTurnMock.mockResolvedValue(preparedTurn);
  });

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
      getThreadTitle: () => 'Equivalence',
    });

  it('replays the same conversation the rows hold, for a turn with a tool call', async () => {
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: 'equivalence_probe', args: {}, id: 'call_equiv_1' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'probe done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const streaming = buildStreaming();
    const result = await streaming.stream(
      { id: 91, send: vi.fn() },
      {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'test-model',
        threadId: 'thread_equivalence',
        approvalPolicy: 'never',
        messages: [
          { id: 'msg_equiv_1', role: 'user', parts: [{ type: 'text', text: 'run the probe' }] },
        ],
        tools: ['equivalence_probe'],
      }
    );
    expect(result).toMatchObject({ success: true, text: 'probe done' });

    const fromRows = getChatMessages('thread_equivalence').map(row =>
      comparable(parseStoredUiMessageRow(row))
    );
    const fromReplay = rebuildThreadViewFromEvents('thread_equivalence').messages.map(comparable);

    // Identity and order: the two stores must agree on WHICH messages exist
    // and in which order. A dropped fact shows up here as a missing id.
    expect(fromReplay.map(message => message.id)).toEqual(fromRows.map(message => message.id));

    // Role and text: what the human reads. A lost model_text_committed fact
    // (or a lost assistant row) shows up here.
    expect(fromReplay.map(({ id, role, text }) => ({ id, role, text }))).toEqual(
      fromRows.map(({ id, role, text }) => ({ id, role, text }))
    );

    // Tool parts: the historically divergent field (issue #145 — inline
    // execution wrote the row but not the log). A tool call that survives in
    // one store only is drift, not a formatting difference.
    expect(fromReplay.map(message => message.toolCallIds)).toEqual(
      fromRows.map(message => message.toolCallIds)
    );

    // Sanity: the turn actually produced the tool part we are comparing, so a
    // future refactor that makes both sides empty cannot pass vacuously.
    expect(fromReplay.some(message => message.toolCallIds.includes('call_equiv_1'))).toBe(true);
  });

  it('keeps agreeing after a second turn on the same thread', async () => {
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'second answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const streaming = buildStreaming();
    const result = await streaming.stream(
      { id: 92, send: vi.fn() },
      {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'test-model',
        threadId: 'thread_equivalence',
        approvalPolicy: 'never',
        messages: [
          { id: 'msg_equiv_2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
        ],
        tools: [],
      }
    );
    expect(result).toMatchObject({ success: true });

    const fromRows = getChatMessages('thread_equivalence').map(row =>
      comparable(parseStoredUiMessageRow(row))
    );
    const fromReplay = rebuildThreadViewFromEvents('thread_equivalence').messages.map(comparable);

    expect(fromReplay.map(message => message.id)).toEqual(fromRows.map(message => message.id));
    expect(fromReplay.map(({ id, role, text }) => ({ id, role, text }))).toEqual(
      fromRows.map(({ id, role, text }) => ({ id, role, text }))
    );
    // The earlier turn's tool part must survive the second turn in BOTH
    // stores — this is the append-only property the whole design rests on.
    expect(fromReplay.some(message => message.toolCallIds.includes('call_equiv_1'))).toBe(true);
    expect(fromRows.some(message => message.toolCallIds.includes('call_equiv_1'))).toBe(true);
  });
});
