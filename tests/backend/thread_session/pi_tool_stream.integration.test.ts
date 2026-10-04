// @vitest-environment node

/**
 * Switch item 3a (issue #114): a real tool turn under the never-approve
 * policy streams end to end through the real streaming entry, the real turn
 * driver, the real Pi adapter and a real registered tool, against the
 * scripted SSE server. Proven at the consumer boundary:
 *   - the tool executes exactly once with the scripted args, mid-turn;
 *   - the UI sees the tool-call event BEFORE the result and the text deltas;
 *   - shown text === committed text (D22);
 *   - the run row completes and usage lands on the total-prompt convention;
 *   - the second model request carries the tool result;
 *   - the AI SDK is never constructed (routing proof).
 * Regression: an `openai` provider under the same policy keeps the AI SDK
 * harness — Pi never sees the request.
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
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    injectReasoningContentIntoMessages: vi.fn((messages: unknown[]) => messages),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: vi.fn(async (options: { messages: Array<{ parts: Array<{ text: string }> }>; tools?: string[] }) => {
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
        guardedTools: [...(options.tools ?? [])],
        enableTools: (options.tools?.length ?? 0) > 0,
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
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';
import { createScriptedPiServer, sse, type ScriptedPiServer } from '../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
let conversation: ReturnType<typeof createChatPersistence>;
const usageEvents: Array<{ source?: string; usage?: { inputTokens?: number; cacheReadTokens?: number } }> = [];
const executions: string[] = [];

const TOOL_NAME = 'pi_tool_probe';

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
    getThreadTitle: () => 'Pi tool stream',
  });

const chunksOf = (target: { send: (channel: string, payload: unknown) => void }, type: string): Array<Record<string, unknown>> => {
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<[string, Record<string, unknown>]>;
  return calls.filter(call => call[0] === 'chat:ui-chunk' && call[1]?.type === type).map(call => call[1]);
};

const publishedText = (target: { send: (channel: string, payload: unknown) => void }): string =>
  chunksOf(target, 'text-delta')
    .map(chunk => (chunk as { delta?: string }).delta ?? '')
    .join('');

const committedText = (threadId: string): string =>
  rebuildThreadViewFromEvents(threadId)
    .events.filter(e => e.type === MODEL_TEXT_COMMITTED)
    .map(e => (e.payload as { text: string }).text)
    .join('');

const lastRunStatus = (target: { send: (channel: string, payload: unknown) => void }): string | undefined => {
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<[string, { status?: string }]>;
  return calls.filter(call => call[0] === 'chat:run-status').map(call => call[1]?.status).at(-1);
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-tool-stream-'));
  initializeDatabase({ dbPath: path.join(root, 'tool-stream.db') });
  server = await createScriptedPiServer();
  addProvider({
    id: 'provider_pi_tool_stream',
    name: 'Pi tool stream provider',
    type: 'custom-openai',
    api_key: 'key-pi-tools',
    models: '["pi-model"]',
    base_url: `http://127.0.0.1:${server.port}/v1`,
    enabled: true,
  });
  addProvider({
    id: 'provider_sdk_tool_regress',
    name: 'SDK tool regression provider',
    type: 'openai',
    api_key: 'key-sdk',
    models: '["sdk-model"]',
    base_url: 'http://127.0.0.1:9/v1',
    enabled: true,
  });
  defaultToolRegistry.register(
    createTool({
      name: TOOL_NAME,
      type: 'fs',
      description: 'read a scenario file',
      paramSchema: z.object({ path: z.string() }),
      handler: async args => {
        executions.push(args.path);
        return `contents of ${args.path}`;
      },
    })
  );
  conversation = createChatPersistence({
    memory: {} as never,
    onContinuityMessagePersisted: async (): Promise<void> => undefined,
  });
  conversation.createThread({ id: 'thread_pi_tool_stream' });
  conversation.createThread({ id: 'thread_sdk_tool_regress' });
});

afterAll(async () => {
  defaultToolRegistry.remove(TOOL_NAME);
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('switch item 3a: never-approve tool turns on the Pi supply layer', () => {
  it('runs a real tool turn end to end through Pi — tool once, shown committed, run completed', async () => {
    server.setScriptSequence('read the tool probe file', [
      {
        chunks: [
          sse.delta('reading '),
          sse.toolCallDelta('call_pi_1', TOOL_NAME, '{"path":'),
          sse.toolCallDelta(null, null, '"/probe.txt"}'),
          sse.finish('tool_calls', { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 }),
        ],
      },
      {
        chunks: [
          sse.delta('the file says hi'),
          sse.finish('stop', {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 60 },
            completion_tokens_details: { reasoning_tokens: 5 },
          }),
        ],
      },
    ]);

    const target = { id: 801, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_tool_stream',
      model: 'pi-model',
      threadId: 'thread_pi_tool_stream',
      approvalPolicy: 'never',
      messages: [
        {
          id: 'msg_pi_tool',
          role: 'user',
          parts: [{ type: 'text', text: 'read the tool probe file' }],
        },
      ],
      tools: [TOOL_NAME],
    });
    expect(result).toMatchObject({ success: true });

    // The tool executed exactly once, mid-turn, with the scripted args.
    expect(executions).toEqual(['/probe.txt']);

    // The UI saw the tool call BEFORE its result, then the answer streamed.
    const toolCalls = chunksOf(target, 'tool-input-available');
    const toolResults = chunksOf(target, 'tool-output-available');
    expect(toolCalls[0]).toMatchObject({ toolName: TOOL_NAME, input: { path: '/probe.txt' } });
    expect((toolResults[0] as { output?: { type?: string; value?: string } }).output).toMatchObject({
      type: 'text',
      value: 'contents of /probe.txt',
    });

    // Shown text === committed text (D22).
    const shown = publishedText(target);
    expect(shown).toBe('reading the file says hi');
    expect(committedText('thread_pi_tool_stream')).toBe(shown);

    // The run row completed; usage is the per-step CUMULATIVE on the
    // total-prompt convention (30 + 100 billed inputs; 60 cached on step 2).
    expect(lastRunStatus(target)).toBe('completed');
    const usage = usageEvents.find(event => event.source === 'chat.stream');
    expect(usage?.usage).toMatchObject({ inputTokens: 130, cacheReadTokens: 60 });

    // The second model request carried the tool result on the wire.
    const secondWire = JSON.stringify(server.getWire('read the tool probe file', 1).messages);
    expect(secondWire).toContain('contents of /probe.txt');

    // Routing proof: the AI SDK was never constructed; both calls rode Pi.
    expect(createModelMock).not.toHaveBeenCalled();
    expect(server.countRequests('read the tool probe file')).toBe(2);
  }, 30000);

  it('ends the turn as a handoff when the model calls the handoff tool (stopWhen parity)', async () => {
    server.setScriptSequence('hand the task over', [
      {
        chunks: [
          sse.toolCallDelta('call_h', 'handoff', '{"summary":"done enough","next_steps":"rest","reason":"other"}'),
          sse.finish('tool_calls', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
        ],
      },
    ]);

    const target = { id: 803, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_tool_stream',
      model: 'pi-model',
      threadId: 'thread_pi_tool_stream',
      approvalPolicy: 'never',
      messages: [
        { id: 'msg_pi_handoff', role: 'user', parts: [{ type: 'text', text: 'hand the task over' }] },
      ],
      tools: [TOOL_NAME],
    });
    expect(result).toMatchObject({ success: true });

    // stopWhen parity: the turn ENDS at the handoff step — no second model
    // call happens even though the step budget would allow one.
    expect(server.countRequests('hand the task over')).toBe(1);
    expect(lastRunStatus(target)).toBe('completed');

    // The driver projects its own handoff event from the executed call.
    const handoffEvents = chunksOf(target, 'tool-input-available').filter(
      chunk => (chunk as { toolName?: string }).toolName === 'handoff'
    );
    expect(handoffEvents[0]).toMatchObject({
      input: expect.objectContaining({ summary: 'done enough' }),
    });
  }, 30000);

  it('keeps openai providers on the AI SDK harness under the same never policy', async () => {
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall(TOOL_NAME, { path: '/sdk.txt' }, { id: 'call_sdk' }),
        fauxText('sdk tool answer'),
      ])
    );
    const requestsBefore = server.totalRequests();
    const executionsBefore = executions.length;

    const target = { id: 802, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_sdk_tool_regress',
      model: 'sdk-model',
      threadId: 'thread_sdk_tool_regress',
      approvalPolicy: 'never',
      messages: [
        {
          id: 'msg_sdk_tool',
          role: 'user',
          parts: [{ type: 'text', text: 'read the sdk probe file' }],
        },
      ],
      tools: [TOOL_NAME],
    });
    expect(result).toMatchObject({ success: true });

    // The tool still ran — but on the AI SDK path.
    expect(executions.slice(executionsBefore)).toEqual(['/sdk.txt']);
    expect(publishedText(target)).toContain('sdk tool answer');
    expect(lastRunStatus(target)).toBe('completed');
    expect(createModelMock).toHaveBeenCalled();
    // No request reached the scripted server: the turn never rode Pi.
    expect(server.totalRequests()).toBe(requestsBefore);
  }, 30000);
});
