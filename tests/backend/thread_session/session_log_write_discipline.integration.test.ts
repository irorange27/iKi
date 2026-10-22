// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({ userData: vi.fn(() => '') }));
const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', () => ({ getUserDataPath: external.userData }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'review',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  generateChatWithModelMessages: vi.fn(async () => ({
    text: 'SEND_ANSWER',
    usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  })),
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));
import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { listAgentRunsByThread } from '@iki/backend/db/agent_runs';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';

let root: string;
let conversation: ReturnType<typeof createChatPersistence>;
const text = 'REVIEW_RESPONSE_MUST_SURVIVE_SETTLE';
const memory = {
  injectMemoryIntoMessages: (messages: unknown[]): unknown[] => messages,
  getAffectContextMessage: (): string => '',
};

beforeEach(async () => {
  callPiChatMock.mockImplementation(
    createScriptedPiChat([[{ kind: 'text', text: 'SEND_ANSWER' }, { kind: 'done' }]])
  );
  setTurnHarnessFallback(piTurnHarness);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-log-discipline-'));
  external.userData.mockReturnValue(root);
  initializeDatabase({ dbPath: path.join(root, 'discipline.db') });
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'test-model' });
  conversation = createChatPersistence({
    memory: memory as never,
  });
  conversation.createThread({ id: 'review_settle', metadata: '{"mode":"chat"}' });
});
afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

const rejectEventType = (type: string) => {
  getDb().exec(`CREATE TRIGGER discipline_reject_${type} BEFORE INSERT ON session_events
    WHEN NEW.type = '${type}'
    BEGIN SELECT RAISE(ABORT, 'discipline: ${type} write rejected'); END`);
};

const runStream = async () => {
  const errors: string[] = [];
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
      id: 8411,
      send: (channel, value) => {
        const chunk = value as { type?: string; errorText?: string };
        if (channel === 'chat:ui-chunk' && chunk.type === 'error')
          errors.push(chunk.errorText ?? '');
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
  return { result, errors, runs: listAgentRunsByThread('review_settle') };
};

it('losing the input/start fact fails the stream before any model call', async () => {
  rejectEventType('input_accepted');
  const evidence = await runStream();
  expect(callPiChatMock, 'an unrecorded turn must not execute').not.toHaveBeenCalled();
  expect(evidence.result.success).toBe(false);
  expect(evidence.errors.length, 'the subscriber must learn of the failure').toBeGreaterThan(0);
  expect(evidence.runs[0]).toMatchObject({ status: 'failed' });
});

it('losing the committed output fact fails the turn instead of reporting success', async () => {
  rejectEventType('model_output_committed');
  const { result } = await runStream();
  expect(result.success).toBe(false);
  expect(listAgentRunsByThread('review_settle')[0]).toMatchObject({ status: 'failed' });
});

it('a lost failure-path terminal fact is loud but never masks the reported failure', async () => {
  rejectEventType('model_text_committed');
  rejectEventType('turn_failed');
  const evidence = await runStream();
  expect(evidence.runs[0]).toMatchObject({
    status: 'failed',
    error: { code: 'SESSION_LOG_COMMIT_FAILED', retryable: false },
  });
  expect(evidence.result.success).toBe(false);
  expect(
    evidence.errors.length,
    'the original failure must still reach its subscriber'
  ).toBeGreaterThan(0);
});
