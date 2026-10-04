import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({ userData: vi.fn(() => ''), model: vi.fn() }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: external.userData }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: external.model,
  getFullSystemPrompt: () => 'review',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));
import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { getChatMessages } from '@iki/backend/db/chat_message';
import { listAgentRunsByThread } from '@iki/backend/db/agent_runs';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';

let root: string;
let conversation: ReturnType<typeof createChatPersistence>;
const text = 'REVIEW_RESPONSE_MUST_SURVIVE_SETTLE';
const memory = {
  onMessagePersisted: () => undefined,
  injectMemoryIntoMessages: (messages: unknown[]) => messages,
  getAffectContextMessage: () => '',
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-settle-review-'));
  external.userData.mockReturnValue(root);
  initializeDatabase({ dbPath: path.join(root, 'review.db') });
  conversation = createChatPersistence({
    memory: memory as never,
    onContinuityMessagePersisted: async () => undefined,
  });
  conversation.createThread({ id: 'review_settle', metadata: '{"mode":"chat"}' });
  external.model.mockReset();
  external.model.mockReturnValue(new FauxModelProvider([fauxText(text)]));
});
afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

const run = async () => {
  const observed: string[] = [];
  const streaming = createChatStreaming({
    streamCoordinator: createThreadStreamCoordinator(),
    memory: memory as never,
    conversation: conversation as never,
    usage: { recordUsageEvent: () => undefined },
    approvals: {
      ensurePendingApprovalSession: () => undefined,
      registerApprovalBatch: () => undefined,
      cleanupPendingSessionsForSender: () => undefined,
    },
    getThreadTitle: () => 'review',
  });
  const result = await streaming.stream(
    {
      id: 8401,
      send: (channel, value) => {
        const chunk = value as { type?: string; delta?: string };
        if (channel === 'chat:ui-chunk' && chunk.type === 'text-delta')
          observed.push(chunk.delta ?? '');
      },
    },
    {
      providerType: 'openai',
      model: 'review-model',
      threadId: 'review_settle',
      approvalPolicy: 'never',
      tools: [],
      messages: [
        { id: 'review_input', role: 'user', parts: [{ type: 'text', text: 'review question' }] },
      ],
    }
  );
  return {
    result,
    observed: observed.join(''),
    rows: getChatMessages('review_settle'),
    recovered: rebuildThreadViewFromEvents('review_settle'),
  };
};

it('control: a healthy public stream saves, publishes and replays its answer', async () => {
  const evidence = await run();
  expect(evidence.result.success).toBe(true);
  expect(evidence.observed).toBe(text);
  expect(JSON.stringify(evidence.rows)).toContain(text);
  expect(JSON.stringify(evidence.recovered.messages)).toContain(text);
});

it('a public stream must not settle as success after losing the withheld generated answer', async () => {
  getDb().exec(`CREATE TRIGGER review_reject_text BEFORE INSERT ON session_events
    WHEN NEW.type = 'model_text_committed'
    BEGIN SELECT RAISE(ABORT, 'review commit rejected'); END`);
  const evidence = await run();
  // Characterize the reached path before the discriminating assertion:
  // reply generated; rejected text withheld; final UI/history contains no answer.
  expect(external.model).toHaveBeenCalledTimes(1);
  expect(evidence.observed).toBe('');
  expect(JSON.stringify(evidence.rows)).not.toContain(text);
  expect(JSON.stringify(evidence.recovered.messages)).not.toContain(text);
  expect(
    evidence.result.success,
    'withheld output was not retained in history, so completion must report failure'
  ).toBe(false);
  expect(listAgentRunsByThread('review_settle')[0]).toMatchObject({
    status: 'failed',
    error: { code: 'SESSION_LOG_COMMIT_FAILED', retryable: false },
    working: { accumulatedText: text },
  });
  expect(evidence.recovered.turns.at(-1)).toMatchObject({ status: 'failed' });
});
