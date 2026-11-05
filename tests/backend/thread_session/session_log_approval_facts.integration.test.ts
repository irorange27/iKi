// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const rejectedTypes = vi.hoisted(() => ({ types: new Set<string>() }));

vi.mock('@iki/store/session_events', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/store/session_events')>();
  const guard = (events: { type: string }[]) => {
    if (events.some(event => rejectedTypes.types.has(event.type))) {
      throw new Error('facts: write rejected');
    }
  };
  return {
    ...actual,
    appendSessionFacts: (threadId: string, events: { type: string }[]) => {
      guard(events);
      return actual.appendSessionFacts(threadId, events as never);
    },
    appendSessionEvents: (threadId: string, expected: number, events: { type: string }[]) => {
      guard(events);
      return actual.appendSessionEvents(threadId, expected, events as never);
    },
    insertSessionEventsAtHead: (threadId: string, events: { type: string }[]) => {
      guard(events);
      return actual.insertSessionEventsAtHead(threadId, events as never);
    },
  };
});

vi.mock('@iki/ai/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/ai/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/ai/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/ai/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: () => 'audit system',
    getModelGenerationSettings: () => ({}),
    resolveModelCapability: async () => ({
      contextWindow: 100000,
      maxInputTokens: 98000,
      maxOutputTokens: 2000,
    }),
    generateChatWithModelMessages: vi.fn(async () => ({
      text: 'send answer',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    })),
  };
});

import { closeDatabase, initializeDatabase } from '@iki/store/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { addWorkspace } from '@iki/store/workspaces';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import {
  rebuildThreadViewFromEvents,
  APPROVAL_REQUESTED,
  APPROVAL_DECIDED,
} from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

describe('session log approval facts across entries', () => {
  let dataDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;

  let approvalsSingleton: ReturnType<typeof createChatApproval> | null = null;
  // The approval owner holds the pending sessions and their execution bindings
  // in memory, so a test must drive one instance, not build a second.
  const buildApprovals = () =>
    (approvalsSingleton ??= createChatApproval({
      streams: {
        tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
        peek: coordinator.peekStream,
        attach: coordinator.attachStream,
        detach: coordinator.detachStream,
      },
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
    }));

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-session-facts-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'facts.db') });
    seedTurnProvider({ providerId: 'provider_primary', model: 'test-model' });
    const a = path.join(dataDir, 'a');
    await fs.mkdir(a, { recursive: true });
    addWorkspace({ id: 'workspace_facts', path: a, name: 'facts' });
    conversation = createChatPersistence({
      memory: memory as never,
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
    setTurnHarnessFallback(piTurnHarness);
    vi.clearAllMocks();
    coordinator = createThreadStreamCoordinator();
    memory.injectMemoryIntoMessages.mockClear();
  });

  it('records the full approval loop: request, decision, continuation', async () => {
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

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: 'write_file',
            args: { path: 'facts.txt', content: 'facts' },
            id: 'call_facts',
          },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );

    const turn = streaming.stream(
      { id: 91, send: vi.fn() },
      {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'test-model',
        threadId: 'thread_facts',
        approvalPolicy: 'always',
        messages: [
          { id: 'msg_facts_1', role: 'user', parts: [{ type: 'text', text: 'write it' }] },
        ],
        tools: ['write_file'],
      }
    );
    const pauseResult = await turn;
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });

    const pausedView = rebuildThreadViewFromEvents('thread_facts');
    const requested = pausedView.events.filter(event => event.type === APPROVAL_REQUESTED);
    expect(requested).toHaveLength(1);
    expect(pausedView.approvals).toHaveLength(1);
    expect(pausedView.approvals[0]).toMatchObject({ status: 'pending', toolName: 'write_file' });
    const pausedTurn = pausedView.turns.at(-1);
    expect(pausedTurn).toBeDefined();
    expect(
      pausedView.events.some(
        event =>
          ['turn_completed', 'turn_failed', 'turn_cancelled'].includes(event.type) &&
          (event.payload as { runId?: string }).runId === pausedTurn!.runId
      )
    ).toBe(false);

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'written and done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const approvalId = pausedView.approvals[0]!.approvalId;
    const approveResult = await approvals.approveTool({ id: 92, send: vi.fn() }, approvalId, true);
    expect(approveResult).toMatchObject({ success: true, awaitingApproval: false });

    const view = rebuildThreadViewFromEvents('thread_facts');
    expect(view.events.filter(event => event.type === APPROVAL_DECIDED)).toHaveLength(1);
    expect(view.approvals).toEqual([
      expect.objectContaining({
        approvalId,
        status: 'approved',
        toolName: 'write_file',
        decisionSource: 'user',
      }),
    ]);

    const completed = view.turns.filter(turn => turn.status === 'completed');
    expect(completed).toHaveLength(2);
    expect(completed.map(turn => turn.kind).sort()).toEqual(['approval-resume', 'chat-turn']);

    const last = view.messages.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(JSON.stringify(last.parts)).toContain('written and done');
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

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: 'write_file',
            args: { path: 'retry.txt', content: 'retry' },
            id: 'call_retry',
          },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );
    const pauseResult = await streaming.stream(
      { id: 96, send: vi.fn() },
      {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'test-model',
        threadId: 'thread_facts',
        approvalPolicy: 'always',
        messages: [
          {
            id: 'msg_facts_retry',
            role: 'user',
            parts: [{ type: 'text', text: 'write it again' }],
          },
        ],
        tools: ['write_file'],
      }
    );
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });
    const approvalId = rebuildThreadViewFromEvents('thread_facts').approvals.find(
      approval => approval.toolCallId === 'call_retry'
    )!.approvalId;

    rejectedTypes.types.add('approval_decided');
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'written on retry' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    try {
      await expect(
        approvals.approveTool({ id: 97, send: vi.fn() }, approvalId, true)
      ).rejects.toThrow('Failed to append turn facts to the session log.');
    } finally {
      rejectedTypes.types.clear();
    }

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
            budget: { step: 20 },
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
