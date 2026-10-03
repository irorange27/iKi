// @vitest-environment node

/**
 * Differential run (issue #104 step 2): the SAME confirmed scenario driven
 * through BOTH supply paths — the current engine (AI SDK harness + faux
 * model) and the candidate (Pi adapter + scripted HTTP server) — asserting
 * the SAME invariants over each. The libraries differ in chunk shapes and
 * internals; the CONTRACT must not:
 *   1. the tool executes exactly once, with the same bound args;
 *   2. shown text === committed text (D22);
 *   3. replay from the session log alone reproduces what was shown;
 *   4. the second model request carries the tool result;
 *   5. the turn ends with the expected final answer.
 */

// ── current-engine scaffolding (AI SDK harness, faux model) ────────────────
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
    resolveModelCapability: async () => ({
      contextWindow: 100000,
      maxInputTokens: 98000,
      maxOutputTokens: 2000,
    }),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: vi.fn().mockResolvedValue({
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
      guardedTools: ['read_file'],
      enableTools: true,
    }),
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
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
import {
  MODEL_TEXT_COMMITTED,
  SESSION_EVENT_VERSION,
  recordSessionEvents,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';

import { callModel, createScriptedModel } from '../pi_candidate/helpers/candidate';
import { createScriptedPiServer, sse, type ScriptedPiServer } from '../pi_candidate/helpers/scripted_pi_server';

// ── shared scenario state: ONE real tool, ONE effect log, shared DB ────────
let root: string;
let server: ScriptedPiServer;
const executions: string[] = [];

const readFileTool = createTool({
  name: 'read_file',
  type: 'fs',
  description: 'Read a file',
  paramSchema: z.object({ path: z.string() }),
  handler: async args => {
    executions.push(`read_file:${args.path}`);
    return { content: `contents of /scenario.txt` };
  },
});

type Capture = {
  toolExecutions: string[];
  publishedText: string;
  committedText: string;
  replayText: string;
  secondRequestCarries: (needle: string) => boolean;
  finalText: string;
};

const assertScenarioInvariants = (label: string, c: Capture) => {
  // 1. exactly once, same args — regardless of engine.
  expect(c.toolExecutions, `${label}: tool executions`).toEqual(['read_file:/scenario.txt']);
  // 2. shown ⊆ committed, and everything the model said was shown.
  expect(c.publishedText).toContain('first segment.');
  expect(c.publishedText).toContain('second segment.');
  expect(c.committedText).toBe(c.publishedText);
  // 3. replay from the log alone reproduces the shown text.
  expect(c.replayText).toBe(c.publishedText);
  // 4. the second model request carries the tool result.
  expect(c.secondRequestCarries('contents of /scenario.txt'), `${label}: second request`).toBe(true);
  // 5. final answer.
  expect(c.finalText).toContain('all done');
};

let conversation: ReturnType<typeof createChatPersistence>;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-differential-'));
  initializeDatabase({ dbPath: path.join(root, 'differential.db') });
  server = await createScriptedPiServer();
  defaultToolRegistry.register(readFileTool);
  conversation = createChatPersistence({
    memory: {} as never,
    onContinuityMessagePersisted: async () => undefined,
  });
  conversation.createThread({ id: 'thread_diff_current' });
});

afterAll(async () => {
  defaultToolRegistry.remove('read_file');
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

// ── driver A: current engine ────────────────────────────────────────────────
describe('differential: current engine (AI SDK harness)', () => {
  it('runs the scenario through the streaming harness', async () => {
    const model = new FauxModelProvider([
      fauxToolCall('read_file', { path: '/scenario.txt' }, { id: 'call_a', textBefore: 'first segment. ' }),
      fauxText('second segment. all done'),
    ]);
    const doStreamSpy = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const target = { id: 700, send: vi.fn() };
    const streaming = createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
      memory: {} as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Differential',
    });

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'differential-model',
      threadId: 'thread_diff_current',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_diff_a', role: 'user', parts: [{ type: 'text', text: 'read the scenario file' }] }],
      tools: ['read_file'],
    });
    expect(result).toMatchObject({ success: true });

    const publishedChunks = target.send.mock.calls
      .filter(call => call[0] === 'chat:ui-chunk' && (call[1] as { type: string }).type === 'text-delta')
      .map(call => (call[1] as { delta?: string }).delta ?? '');
    const committedChunks = rebuildThreadViewFromEvents('thread_diff_current')
      .events.filter(e => e.type === MODEL_TEXT_COMMITTED)
      .map(e => (e.payload as { text: string }).text);
    const replay = rebuildThreadViewFromEvents('thread_diff_current')
      .messages.at(-1)!
      .parts.map(p => (p as { text?: string }).text ?? '')
      .join('');

    // The second model call's prompt must contain the tool result.
    const secondPrompt = JSON.stringify(doStreamSpy.mock.calls[1]?.[0] ?? {});

    assertScenarioInvariants('current', {
      toolExecutions: [...executions],
      publishedText: publishedChunks.join(''),
      committedText: committedChunks.join(''),
      replayText: replay,
      secondRequestCarries: needle => secondPrompt.includes(needle),
      finalText: publishedChunks.join(''),
    });
    executions.length = 0;
  });
});

// ── driver B: candidate (Pi adapter + scripted server) ─────────────────────
describe('differential: candidate (Pi supply adapter)', () => {
  it('runs the same scenario through the Pi supply layer', async () => {
    const model = createScriptedModel(server.port);
    server.setScript('read the scenario file', {
      chunks: [
        sse.delta('first segment. '),
        sse.toolCallDelta('call_b', 'read_file', '{"path":'),
        sse.toolCallDelta(null, null, '"\u002fscenario.txt"}'),
        sse.finish('tool_calls'),
      ],
    });

    const threadId = 'thread_diff_candidate';
    const context = {
      systemPrompt: 'candidate',
      messages: [{ role: 'user', content: 'read the scenario file', timestamp: Date.now() }],
      tools: [
        {
          name: readFileTool.name,
          description: readFileTool.description,
          parameters: readFileTool.parameters,
        },
      ],
    };

    // Turn 1: leading text + the tool call.
    const turn1 = await callModel(model, context, { apiKey: 'test-key' });
    const result1 = turn1.final;
    const toolCall = result1.content.find(b => b.type === 'toolCall') as {
      id: string;
      name: string;
      arguments: { path: string };
    };
    expect(toolCall.name).toBe('read_file');

    // The segment boundary IS a commit point: the pre-tool text lands in the
    // log before the effect runs (the fixed owner's ordering).
    const turn1Text = turn1.deltas.join('');
    recordSessionText(threadId, turn1Text);

    // The REAL tool executes (shared instance, shared effect log).
    const output = await readFileTool.handler(toolCall.arguments);

    // Turn 2: the candidate commits the result and asks for the answer, with
    // the rereview-G1 commit gate (commit lands, then publish).
    server.setScript('read the scenario file', {
      chunks: [sse.delta('second segment. all done'), sse.finish('stop')],
    });
    const turn2 = await callModel(
      model,
      {
        ...context,
        messages: [
          ...context.messages,
          result1,
          {
            role: 'toolResult',
            toolCallId: toolCall.id,
            toolName: 'read_file',
            content: [{ type: 'text', text: JSON.stringify(output) }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: 'test-key' }
    );
    const final = turn2.final;
    const turn2Text = turn2.deltas.join('');
    recordSessionText(threadId, turn2Text);
    const published = turn1Text + turn2Text;
    // The assistant-output fact closes the turn (replay needs it).
    recordSessionEvents(threadId, [
      {
        type: 'model_output_committed',
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_diff_b',
          messageId: 'msg_diff_b',
          message: { id: 'msg_diff_b', role: 'assistant', parts: [{ type: 'text', text: published }] },
          transport: 'pi-candidate',
        },
      },
    ]);

    const committedChunks = rebuildThreadViewFromEvents(threadId)
      .events.filter(e => e.type === MODEL_TEXT_COMMITTED)
      .map(e => (e.payload as { text: string }).text);
    const replay = rebuildThreadViewFromEvents(threadId)
      .messages.at(-1)!
      .parts.map(p => (p as { text?: string }).text ?? '')
      .join('');

    // The second request's wire must carry the tool result.
    const wire = server.getWire('read the scenario file', 1);
    const wireJson = JSON.stringify(wire.messages);

    assertScenarioInvariants('candidate', {
      toolExecutions: [...executions],
      publishedText: published,
      committedText: committedChunks.join(''),
      replayText: replay,
      secondRequestCarries: needle => wireJson.includes(needle),
      finalText: textOfPi(final),
    });
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
function recordSessionText(threadId: string, text: string) {
  // One commit for the whole (single-delta) tail — the gate ordering under
  // test lives in the fixed owner and the candidate's own scenario C; this
  // file compares contract outcomes, not flush cadence.
  recordSessionEvents(threadId, [
    {
      type: MODEL_TEXT_COMMITTED,
      version: SESSION_EVENT_VERSION,
      payload: { runId: 'run_diff_b', messageId: 'msg_diff_b', seq: 0, text },
    },
  ]);
}

function textOfPi(final: { content: Array<{ type: string; text?: string }> }): string {
  return final.content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');
}
