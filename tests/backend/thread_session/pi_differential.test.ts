// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());

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
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import {
  MODEL_OUTPUT_COMMITTED,
  MODEL_TEXT_COMMITTED,
  SESSION_EVENT_VERSION,
  recordSessionEvents,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';

import { callModel, createScriptedModel } from '../pi_candidate/helpers/candidate';
import {
  createScriptedPiServer,
  sse,
  type ScriptedPiServer,
} from '../pi_candidate/helpers/scripted_pi_server';

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
  expect(c.toolExecutions, `${label}: tool executions`).toEqual(['read_file:/scenario.txt']);
  expect(c.publishedText).toContain('first segment.');
  expect(c.publishedText).toContain('second segment.');
  expect(c.committedText).toBe(c.publishedText);
  expect(c.replayText).toBe(c.publishedText);
  expect(c.secondRequestCarries('contents of /scenario.txt'), `${label}: second request`).toBe(
    true
  );
  expect(c.finalText).toContain('all done');
};

let conversation: ReturnType<typeof createChatPersistence>;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-differential-'));
  initializeDatabase({ dbPath: path.join(root, 'differential.db') });
  seedTurnProvider({ providerId: 'provider_primary', model: 'test-model' });
  server = await createScriptedPiServer();
  defaultToolRegistry.register(readFileTool);
  conversation = createChatPersistence({
    memory: {} as never,
  });
  conversation.createThread({ id: 'thread_diff_current' });
});

afterAll(async () => {
  defaultToolRegistry.remove('read_file');
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

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

    const turn1 = await callModel(model, context, { apiKey: 'test-key' });
    const result1 = turn1.final;
    const toolCall = result1.content.find(b => b.type === 'toolCall') as {
      id: string;
      name: string;
      arguments: { path: string };
    };
    expect(toolCall.name).toBe('read_file');

    const turn1Text = turn1.deltas.join('');
    recordSessionText(threadId, 0, turn1Text);

    const output = await readFileTool.handler(toolCall.arguments);

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
    recordSessionText(threadId, 1, turn2Text);
    const published = turn1Text + turn2Text;
    recordSessionEvents(threadId, [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_diff_b',
          messageId: 'msg_diff_b',
          message: {
            id: 'msg_diff_b',
            role: 'assistant',
            parts: [{ type: 'text', text: published }],
          },
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

function recordSessionText(threadId: string, seq: number, text: string) {
  recordSessionEvents(threadId, [
    {
      type: MODEL_TEXT_COMMITTED,
      version: SESSION_EVENT_VERSION,
      payload: { runId: 'run_diff_b', messageId: 'msg_diff_b', seq, text },
    },
  ]);
}

function textOfPi(final: { content: Array<{ type: string; text?: string }> }): string {
  return final.content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');
}
