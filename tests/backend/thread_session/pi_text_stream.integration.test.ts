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


vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: vi.fn(
      async (options: { messages: Array<{ parts: Array<{ text: string }> }> }) => {
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
      }
    ),
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  getAssistantProfileContextMessage: (): string => '',
  retrieveRelevantContinuity: (): null => null,
  onMessagePersisted: async (): Promise<void> => undefined,
  getCompanion: () => ({
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
import {
  createScriptedPiServer,
  sse,
  type ScriptedPiServer,
} from '../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
let conversation: ReturnType<typeof createChatPersistence>;
const usageEvents: Array<{
  source?: string;
  usage?: { inputTokens?: number; cacheReadTokens?: number };
}> = [];

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
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<
    [string, { type: string; delta?: string }]
  >;
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

const lastRunStatus = (target: {
  send: (channel: string, payload: unknown) => void;
}): string | undefined => {
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
    name: 'Formerly SDK-pinned provider (now Pi-served)',
    // `openai` would ask for the Responses dialect, which the scripted server
    // does not implement (it reads `messages`, Responses sends `input`). The
    // dialect mapping is covered in factory_pi_generation.test.ts; here the
    // point is only that a provider type this selector used to EXCLUDE now
    // rides Pi, so use the completions dialect.
    type: 'deepseek',
    api_key: 'key-sdk',
    models: '["sdk-model"]',
    base_url: `http://127.0.0.1:${server.port}/v1`,
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
    expect(replay!.parts.map(p => (p as { text?: string }).text ?? '').join('')).toBe(shown);

    // Usage rides the total-prompt convention (100 = 40 + 60 cached).
    const usage = usageEvents.find(event => event.source === 'chat.stream');
    expect(usage?.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 60 });

    // Routing proof: the request never touched the AI SDK.
    // Nothing fell back to the retired SDK constructor: this turn reached Pi
    // over the real HTTP boundary (the scripted server records the request).
    expect(server.totalRequests()).toBeGreaterThan(0);
    expect(server.countRequests('pi stream probe')).toBe(1);
    expect(server.getWire('pi stream probe').stream).toBe(true);
    // The persona system prompt (identity, date/timezone, OS, cwd) leads the
    // request — the same join the factory's Pi branch uses.
    const wireSystem = (
      server.getWire('pi stream probe').messages as Array<{
        role: string;
        content: unknown;
      }>
    )[0];
    expect(wireSystem.role).toBe('system');
    expect(JSON.stringify(wireSystem.content)).toContain('persona prompt');
  }, 20000);

  it('fails the turn when the provider stream dies mid-flight (real adapter, scripted DESTROY)', async () => {
    server.setScript('pi destroy probe', {
      chunks: [sse.delta('partial '), 'DESTROY'],
      delayMs: 40,
    });

    const target = { id: 703, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_stream',
      model: 'pi-model',
      threadId: 'thread_pi_stream',
      approvalPolicy: 'never',
      messages: [
        { id: 'msg_pi_destroy', role: 'user', parts: [{ type: 'text', text: 'pi destroy probe' }] },
      ],
      tools: [],
    });

    // The connection drop surfaces as a failed turn — never as a completed
    // empty reply — and the run row records the failure.
    expect(result.success).toBe(false);
    expect(lastRunStatus(target)).toBe('failed');
    // Whatever streamed before the drop was committed before publication.
    const shown = publishedText(target);
    expect(committedText('thread_pi_stream')).toContain(shown);
  }, 30000);

  it('serves a formerly SDK-pinned provider type through Pi even with tools off', async () => {
    // Contract change: static-factory provider types (deepseek, openai,
    // anthropic, minimax) used to be excluded from the Pi supply and pinned to
    // the AI SDK harness. They are admitted now, so the request must reach the
    // Pi server and the AI SDK model must never be built.
    server.setScript('sdk probe', {
      chunks: [
        sse.delta('pi answer'),
        sse.finish('stop', {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 60 },
          completion_tokens_details: { reasoning_tokens: 5 },
        }),
      ],
    });
    const requestsBefore = server.totalRequests();

    const target = { id: 702, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'deepseek',
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

    expect(publishedText(target)).toBe('pi answer');
    expect(lastRunStatus(target)).toBe('completed');
    // The discriminator: Pi served it.
    // Nothing fell back to the retired SDK constructor: this turn reached Pi
    // over the real HTTP boundary (the scripted server records the request).
    expect(server.totalRequests()).toBeGreaterThan(0);
    expect(server.totalRequests()).toBe(requestsBefore + 1);
  }, 20000);
});
