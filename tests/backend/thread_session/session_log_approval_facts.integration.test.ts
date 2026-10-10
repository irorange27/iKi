// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    resolvePersonaPrompt: () => 'audit system',
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
      text: 'send answer',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    })),
  };
});

import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { onMessagePersisted } from '@iki/backend/thread_session/platform';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import {
  rebuildThreadViewFromEvents,
  APPROVAL_REQUESTED,
  APPROVAL_DECIDED,
} from '@iki/backend/thread_session/session_log';
import { createMessageSend } from '@iki/backend/thread_session/message_send';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// Stage C slice 2: every entry records facts. The full approval loop with
// real components — a stream pauses on a write approval, the decision comes
// through the real approveTool entry, the continuation completes — and the
// replay rebuilds the whole story: messages, the paused parent plus its
// completed continuation, and the approval's requested→decided states. The
// send entry records the same facts from its waiter transport.
describe('session log approval facts across entries', () => {
  let dataDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;

  const buildApprovals = () =>
    createChatApproval({
      streams: {
        tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
        peek: coordinator.peekStream,
        attach: coordinator.attachStream,
        detach: coordinator.detachStream,
      },
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
    });

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-session-facts-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'facts.db') });
    const a = path.join(dataDir, 'a');
    await fs.mkdir(a, { recursive: true });
    addWorkspace({ id: 'workspace_facts', path: a, name: 'facts' });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: onMessagePersisted,
    });
    conversation.createThread({
      id: 'thread_facts',
      workspace_id: 'workspace_facts',
      metadata: '{"mode":"work"}',
    });
    defaultToolRegistry.register(new WriteFileTool().toAgentTool());
  });

  afterAll(async () => {
    defaultToolRegistry.remove('write_file');
    closeDatabase();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = createThreadStreamCoordinator();
    memory.injectMemoryIntoMessages.mockClear();
  });

  it('records the full approval loop: request, decision, continuation', async () => {
    // One approvals registry shared by the stream and the approval entry —
    // the same wiring the composition root uses.
    const approvals = buildApprovals();
    const streaming = createChatStreaming({
      streamCoordinator: coordinator,
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
        registerApprovalBatch: approvals.registerApprovalBatch,
        cleanupPendingSessionsForSender: approvals.cleanupPendingSessionsForSender,
      },
      getThreadTitle: () => 'Facts',
    });

    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall('write_file', { path: 'facts.txt', content: 'facts' }, { id: 'call_facts' }),
      ])
    );

    const turn = streaming.stream({ id: 91, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_facts',
      approvalPolicy: 'always',
      messages: [{ id: 'msg_facts_1', role: 'user', parts: [{ type: 'text', text: 'write it' }] }],
      tools: ['write_file'],
    });
    const pauseResult = await turn;
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });

    // Mid-pause: the approval request is a recorded fact, the paused run has
    // no terminal event, and the partial output is committed.
    const pausedView = rebuildThreadViewFromEvents('thread_facts');
    const requested = pausedView.events.filter(event => event.type === APPROVAL_REQUESTED);
    expect(requested).toHaveLength(1);
    expect(pausedView.approvals).toHaveLength(1);
    expect(pausedView.approvals[0]).toMatchObject({ status: 'pending', toolName: 'write_file' });
    const pausedTurn = pausedView.turns.at(-1);
    expect(pausedTurn).toBeDefined();
    expect(pausedView.events.some(event =>
      ['turn_completed', 'turn_failed', 'turn_cancelled'].includes(event.type) &&
      (event.payload as { runId?: string }).runId === pausedTurn!.runId
    )).toBe(false);

    // Approve through the real entry; the continuation completes.
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('written and done')]));
    const approvalId = pausedView.approvals[0]!.approvalId;
    const approveResult = await approvals.approveTool({ id: 92, send: vi.fn() }, approvalId, true);
    expect(approveResult).toMatchObject({ success: true, awaitingApproval: false });

    const view = rebuildThreadViewFromEvents('thread_facts');
    // Decision fact with its source.
    expect(view.events.filter(event => event.type === APPROVAL_DECIDED)).toHaveLength(1);
    expect(view.approvals).toEqual([
      expect.objectContaining({
        approvalId,
        status: 'approved',
        toolName: 'write_file',
        decisionSource: 'user',
      }),
    ]);

    // The parent paused; the continuation is its own completed turn.
    const completed = view.turns.filter(turn => turn.status === 'completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.kind).toBe('approval-resume');

    // The rebuilt conversation carries the final assistant message.
    const last = view.messages.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(JSON.stringify(last.parts)).toContain('written and done');
  });

  it('records send facts from the waiter transport', async () => {
    const send = createMessageSend({
      tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
      checkThreadRunRate: () => ({ allowed: true }),
      usage: { recordUsageEvent: vi.fn() },
      conversation: conversation as never,
      turnPreparer: {
        prepareChatTurn: vi.fn(async () => ({
          report: { totalEstimatedTokens: 1 },
          usedSkills: [],
          selectedSkillIds: [],
          skillMode: 'manual' as const,
          finalMessages: [{ role: 'user' as const, content: 'send probe' }],
          history: [],
          prompt: 'send probe',
          guardActive: false,
          requireApproval: false,
          autoApproveToolRequests: false,
          affectSignal: null,
          interventionPolicy: null,
          guardedTools: [],
          enableTools: false,
        })),
      } as never,
    }).send;

    createModelMock.mockImplementation(() => new FauxModelProvider([fauxText('send answer')]));

    const result = await send({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_facts',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_facts_2', role: 'user', parts: [{ type: 'text', text: 'send probe' }] }],
    });
    expect(result).toMatchObject({ success: true, text: 'send answer' });

    const view = rebuildThreadViewFromEvents('thread_facts');
    const sendTurn = view.turns.at(-1)!;
    expect(sendTurn).toMatchObject({ status: 'completed', kind: 'chat-turn' });
    expect(view.messages.map(message => message.id)).toContain('msg_facts_2');
    const sendRunMessages = view.messages.filter(message =>
      String(message.id).startsWith(`assistant_${sendTurn.runId}`)
    );
    expect(sendRunMessages).toHaveLength(1);
    expect(JSON.stringify(sendRunMessages[0]!.parts)).toContain('send answer');
  });
  it('a decided fact lost to a write failure is re-recorded when the decision is retried', async () => {
    const approvals = buildApprovals();
    const streaming = createChatStreaming({
      streamCoordinator: coordinator,
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
        registerApprovalBatch: approvals.registerApprovalBatch,
        cleanupPendingSessionsForSender: approvals.cleanupPendingSessionsForSender,
      },
      getThreadTitle: () => 'Facts',
    });

    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall('write_file', { path: 'retry.txt', content: 'retry' }, { id: 'call_retry' }),
      ])
    );
    const pauseResult = await streaming.stream({ id: 96, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_facts',
      approvalPolicy: 'always',
      messages: [
        { id: 'msg_facts_retry', role: 'user', parts: [{ type: 'text', text: 'write it again' }] },
      ],
      tools: ['write_file'],
    });
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });
    const approvalId = rebuildThreadViewFromEvents('thread_facts').approvals.find(
      approval => approval.toolCallId === 'call_retry'
    )!.approvalId;

    getDb().exec(`CREATE TRIGGER facts_reject_decided BEFORE INSERT ON session_events
      WHEN NEW.type = 'approval_decided'
      BEGIN SELECT RAISE(ABORT, 'facts: decided write rejected'); END`);
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('written on retry')]));
    try {
      await expect(
        approvals.approveTool({ id: 97, send: vi.fn() }, approvalId, true)
      ).rejects.toThrow('Failed to append turn facts to the session log.');
    } finally {
      // This file shares ONE database across its tests — a leaked aborting
      // trigger cascades into every sibling.
      getDb().exec('DROP TRIGGER IF EXISTS facts_reject_decided');
    }

    // The retried decision heals the fact, not just the flow.
    const retryResult = await approvals.approveTool({ id: 98, send: vi.fn() }, approvalId, true);
    expect(retryResult).toMatchObject({ success: true, awaitingApproval: false });

    const view = rebuildThreadViewFromEvents('thread_facts');
    const decided = view.events.filter(
      event =>
        event.type === APPROVAL_DECIDED &&
        (event.payload as { approvalId?: string }).approvalId === approvalId
    );
    expect(decided).toHaveLength(1);
    expect(view.approvals.find(approval => approval.approvalId === approvalId)).toMatchObject({
      status: 'approved',
    });
  });

  it('records run-cancel expirations as system decisions', async () => {
    const approvals = buildApprovals();
    approvals.registerApprovalBatch(
      [
        {
          approvalId: 'appr_cancelled',
          toolCallId: 'call_cancelled',
          toolCall: { toolName: 'write_file', args: { path: 'x' } },
        },
      ],
      {
        target: { id: 95, send: vi.fn() },
        history: [],
        recoveryContext: {
          plan: {
            providerType: 'openai',
            model: 'test-model',
            enableTools: true,
            enabledTools: ['write_file'],
            availableSkillIds: [],
            guardActive: false,
            requireApproval: true,
            autoApproveToolRequests: false,
            maxIterations: 20,
            systemPrompt: 'system prompt',
            skillMode: 'manual',
            kind: 'chat-turn',
            runMetadata: {},
            transport: 'stream',
            threadId: 'thread_facts',
          },
          sessionId: 'assistant_cancelled',
          assistantMessageId: 'assistant_cancelled',
          runId: 'run_cancelled',
        },
      }
    );

    // The run is cancelled: its pending approval expires as a system
    // decision on the stream, not a pending-forever replay record.
    expect(approvals.cancelPendingApprovalsForRun('run_cancelled')).toBe(1);

    const view = rebuildThreadViewFromEvents('thread_facts');
    const approval = view.approvals.find(entry => entry.approvalId === 'appr_cancelled');
    expect(approval).toMatchObject({
      status: 'rejected',
      decisionSource: 'system',
      decisionReason: expect.stringContaining('cancelled'),
      runId: 'run_cancelled',
      toolName: 'write_file',
    });
  });
});
