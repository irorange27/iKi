// @vitest-environment node

/**
 * Switch item 2c (issue #110): text-only streaming turns route onto the Pi
 * supply layer through the real streaming entry (createChatStreaming), the
 * real turn driver and the real Pi adapter against the scripted SSE server.
 * Proven at the consumer boundary:
 *   - the UI stream publishes the scripted text (live deltas);
 *   - shown text === committed text (D22 session-log gate);
 *   - the run row completes and usage lands on the total-prompt convention;
 *   - the request never touches the AI SDK (createModel uncalled).
 * Regression: an 'openai' provider keeps the AI SDK harness — Pi never sees
 * the request even when tools are off.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    getFullSystemPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    injectReasoningContentIntoMessages: vi.fn((messages: unknown[]) => messages),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: vi.fn(async (options: { messages: Array<{ parts: Array<{ text: string }> }> }) => {
      const prompt = options.messages[0]?.parts[0]?.text ?? 'probe';
      return {
        report: { totalEstimatedTokens: 1, blocks: [] },
        usedSkills: [],
        selectedSkillIds: [],
        skillMode: 'manual' as const,
        finalMessages: [{ role: 'user' as const, content: prompt }],
        history: [] as unknown[],
        prompt,
        guardActive: false,
        requireApproval: false,
        autoApproveToolRequests: false,
        affectSignal: null,
        interventionPolicy: null,
        guardedTools: [],
        enableTools: false,
        maxInputTokens: 98000,
        maxOutputTokens: 2000,
      };
    }),
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  getAssistantProfileContextMessage: (): string => '',
  retrieveRelevantContinuity: (): null => null,
  onMessagePersisted: async (): Promise<void> => undefined,
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
import { addProvider } from '@iki/backend/db/providers';
import {
  MODEL_TEXT_COMMITTED,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';
import { createScriptedPiServer, sse, type ScriptedPiServer } from '../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
let conversation: ReturnType<typeof createChatPersistence>;
const usageEvents: Array<{ source?: string; usage?: { inputTokens?: number; cacheReadTokens?: number } }> = [];

const buildStreaming = () =>
  createChatStreaming({
    streamCoordinator: createThreadStreamCoordinator(),
    memory: {} as never,
    conversation: conversation as never,
    usage: {
      recordUsageEvent: event => {
        usageEvents.push({ source: event.source, usage: event.usage });
      },
    },
    approvals: {
      ensurePendingApprovalSession: vi.fn(),
      registerApprovalBatch: vi.fn(),
      cleanupPendingSessionsForSender: vi.fn(),
    },
    getThreadTitle: () => 'Pi text stream',
  });

const publishedText = (target: { send: (channel: string, payload: unknown) => void }): string => {
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<[string, { type: string; delta?: string }]>;
  return calls
    .filter(call => call[0] === 'chat:ui-chunk' && call[1]?.type === 'text-delta')
    .map(call => call[1].delta ?? '')
    .join('');
};

const committedText = (threadId: string): string =>
  rebuildThreadViewFromEvents(threadId)
    .events.filter(e => e.type === MODEL_TEXT_COMMITTED)
    .map(e => (e.payload as { text: string }).text)
    .join('');

const lastRunStatus = (target: { send: (channel: string, payload: unknown) => void }): string | undefined => {
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<
    [string, { status?: string }]
  >;
  const statuses = calls.filter(call => call[0] === 'chat:run-status').map(call => call[1]?.status);
  return statuses.at(-1);
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-text-stream-'));
  initializeDatabase({ dbPath: path.join(root, 'text-stream.db') });
  server = await createScriptedPiServer();
  addProvider({
    id: 'provider_pi_stream',
    name: 'Pi stream provider',
    type: 'custom-openai',
    api_key: 'key-pi-stream',
    models: '["pi-model"]',
    base_url: `http://127.0.0.1:${server.port}/v1`,
    enabled: true,
  });
  addProvider({
    id: 'provider_sdk_regress',
    name: 'SDK regression provider',
    type: 'openai',
    api_key: 'key-sdk',
    models: '["sdk-model"]',
    base_url: 'http://127.0.0.1:9/v1',
    enabled: true,
  });
  conversation = createChatPersistence({
    memory: {} as never,
    onContinuityMessagePersisted: async () => undefined,
  });
  conversation.createThread({ id: 'thread_pi_stream' });
  conversation.createThread({ id: 'thread_sdk_regress' });
});

afterAll(async () => {
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('switch item 2c: text-only streaming turns on the Pi supply layer', () => {
  it('streams a text turn end to end through Pi — shown text committed, run completed, usage mapped', async () => {
    server.setScript('pi stream probe', {
      chunks: [
        sse.delta('hello '),
        sse.delta('from pi'),
        sse.finish('stop', {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 60 },
          completion_tokens_details: { reasoning_tokens: 5 },
        }),
      ],
    });

    const target = { id: 701, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_stream',
      model: 'pi-model',
      threadId: 'thread_pi_stream',
      approvalPolicy: 'never',
      messages: [
        { id: 'msg_pi_stream', role: 'user', parts: [{ type: 'text', text: 'pi stream probe' }] },
      ],
      tools: [],
    });
    expect(result).toMatchObject({ success: true });

    // The scripted text streamed live through the driver's commit gate.
    const shown = publishedText(target);
    expect(shown).toBe('hello from pi');
    expect(committedText('thread_pi_stream')).toBe(shown);

    // The run row completed and the turn closed as an assistant message.
    expect(lastRunStatus(target)).toBe('completed');
    const replay = rebuildThreadViewFromEvents('thread_pi_stream').messages.at(-1);
    expect(replay?.role).toBe('assistant');
    expect(
      replay!.parts.map(p => (p as { text?: string }).text ?? '').join('')
    ).toBe(shown);

    // Usage rides the total-prompt convention (100 = 40 + 60 cached).
    const usage = usageEvents.find(event => event.source === 'chat.stream');
    expect(usage?.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 60 });

    // Routing proof: the request never touched the AI SDK.
    expect(createModelMock).not.toHaveBeenCalled();
    expect(server.countRequests('pi stream probe')).toBe(1);
    expect(server.getWire('pi stream probe').stream).toBe(true);
  }, 20000);

  it('keeps openai providers on the AI SDK harness even with tools off', async () => {
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('sdk answer')]));
    const requestsBefore = server.totalRequests();

    const target = { id: 702, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_sdk_regress',
      model: 'sdk-model',
      threadId: 'thread_sdk_regress',
      approvalPolicy: 'never',
      messages: [
        { id: 'msg_sdk_regress', role: 'user', parts: [{ type: 'text', text: 'sdk probe' }] },
      ],
      tools: [],
    });
    expect(result).toMatchObject({ success: true });

    expect(publishedText(target)).toBe('sdk answer');
    expect(lastRunStatus(target)).toBe('completed');
    expect(createModelMock).toHaveBeenCalled();
    // No request reached the scripted server: the turn never rode Pi.
    expect(server.totalRequests()).toBe(requestsBefore);
  }, 20000);
});
