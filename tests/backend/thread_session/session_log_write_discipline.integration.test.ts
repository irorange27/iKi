// @vitest-environment node

/**
 * ADR 008 unit F1 (issue #129): fail-closed session-log write discipline.
 * A fact that failed to record must not be indistinguishable from a recorded
 * one — pre-execution and success-path facts fail the turn; a failure-path
 * terminal fact is loud-guarded so the record loss never masks the original
 * failure reaching its subscriber. Write failures are injected with SQLite
 * triggers on session_events (same injection shape as the D22 commit-gate
 * suite) — the real DB layer, no mocks on the record path.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({ userData: vi.fn(() => ''), model: vi.fn() }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: external.userData }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: external.model,
  resolvePersonaPrompt: () => 'review',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // The no-tools send path calls this module-internal function whose own
  // createModel binding the namespace mock cannot intercept — a partial
  // mock would let a REAL provider request leave the test process.
  generateChatWithModelMessages: vi.fn(async () => ({
    text: 'SEND_ANSWER',
    usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  })),
}));
import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { listAgentRunsByThread } from '@iki/backend/db/agent_runs';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createMessageSend } from '@iki/backend/thread_session/message_send';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';

let root: string;
let conversation: ReturnType<typeof createChatPersistence>;
const text = 'REVIEW_RESPONSE_MUST_SURVIVE_SETTLE';
const memory = {
  onMessagePersisted: (): void => undefined,
  injectMemoryIntoMessages: (messages: unknown[]): unknown[] => messages,
  getAffectContextMessage: (): string => '',
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-log-discipline-'));
  external.userData.mockReturnValue(root);
  initializeDatabase({ dbPath: path.join(root, 'discipline.db') });
  conversation = createChatPersistence({
    memory: memory as never,
    onContinuityMessagePersisted: async (): Promise<void> => undefined,
  });
  conversation.createThread({ id: 'review_settle', metadata: '{"mode":"chat"}' });
  external.model.mockReset();
  external.model.mockReturnValue(new FauxModelProvider([fauxText(text)]));
});
afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

/** Make the real session_events INSERT abort for one event type. */
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

const runSend = async () => {
  const send = createMessageSend({
    tryAcquireThreadRun: () => () => undefined,
    checkThreadRunRate: () => ({ allowed: true }),
    usage: { recordUsageEvent: () => undefined },
    conversation: conversation as never,
    turnPreparer: {
      prepareChatTurn: async () => ({
        report: { totalEstimatedTokens: 1 },
        usedSkills: [] as string[],
        selectedSkillIds: [] as string[],
        skillMode: 'manual' as const,
        finalMessages: [{ role: 'user' as const, content: 'send probe' }],
        history: [] as unknown[],
        prompt: 'send probe',
        guardActive: false,
        requireApproval: false,
        autoApproveToolRequests: false,
        affectSignal: null as null,
        interventionPolicy: null as null,
        guardedTools: [] as string[],
        enableTools: false,
      }),
    } as never,
  }).send;
  return send({
    providerType: 'openai',
    model: 'review-model',
    threadId: 'review_settle',
    approvalPolicy: 'never',
    messages: [{ id: 'send_input', role: 'user', parts: [{ type: 'text', text: 'send probe' }] }],
  });
};

it('losing the input/start fact fails the stream before any model call', async () => {
  rejectEventType('input_accepted');
  const evidence = await runStream();
  expect(external.model, 'an unrecorded turn must not execute').not.toHaveBeenCalled();
  expect(evidence.result.success).toBe(false);
  expect(evidence.errors.length, 'the subscriber must learn of the failure').toBeGreaterThan(0);
  expect(evidence.runs[0]).toMatchObject({ status: 'failed' });
});

it('losing the committed output fact fails the send instead of reporting success', async () => {
  rejectEventType('model_output_committed');
  const result = await runSend();
  expect(result.success).toBe(false);
  expect(listAgentRunsByThread('review_settle')[0]).toMatchObject({ status: 'failed' });
});

it('a lost failure-path terminal fact is loud but never masks the reported failure', async () => {
  rejectEventType('model_text_committed');
  rejectEventType('turn_failed');
  const evidence = await runStream();
  // The commit gate still owns the user-facing outcome — its failure mapping
  // ran before the terminal fact was attempted.
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
