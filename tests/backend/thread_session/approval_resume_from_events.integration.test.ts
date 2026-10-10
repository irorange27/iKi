// @vitest-environment node

/**
 * ADR 008 unit F2 (issue #131): the restart-recovered approval resume
 * rebuilds its history from the session log replay alone — run.working and
 * chat_messages are projections and no longer read as authority. The old
 * chat_approval_resume_fallback suite pinned the chat_messages fallback that
 * this unit removes; its still-valid contracts (result shape, exactly-once
 * execution, seeded continuation convergence, finish chunk) are re-pinned
 * here at the real-DB boundary.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'audit system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));

import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { onMessagePersisted } from '@iki/backend/thread_session/platform';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import {
  rebuildThreadViewFromEvents,
  APPROVAL_DECIDED,
} from '@iki/backend/thread_session/session_log';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';
import * as agentRunDb from '@iki/backend/db/agent_runs';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

describe('approval resume reads the session log alone', () => {
  let dataDir = '';
  let workspaceDir = '';
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

  const buildStreaming = (approvals: ReturnType<typeof createChatApproval>) =>
    createChatStreaming({
      streamCoordinator: coordinator,
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
        registerApprovalBatch: approvals.registerApprovalBatch,
        cleanupPendingSessionsForSender: approvals.cleanupPendingSessionsForSender,
      },
      getThreadTitle: () => 'Events',
    });

  const pauseOnWriteFile = async (
    streaming: ReturnType<typeof createChatStreaming>,
    targetId: number
  ) => {
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall(
          'write_file',
          { path: 'resume_events.txt', content: 'resumed' },
          { id: 'call_events' }
        ),
      ])
    );
    const pauseResult = await streaming.stream({ id: targetId, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_events',
      approvalPolicy: 'always',
      messages: [
        {
          id: `msg_events_${targetId}`,
          role: 'user',
          parts: [{ type: 'text', text: 'write it' }],
        },
      ],
      tools: ['write_file'],
    });
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });
    const pausedView = rebuildThreadViewFromEvents('thread_events');
    return pausedView.approvals.at(-1)!.approvalId;
  };

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-resume-events-'));
    workspaceDir = path.join(dataDir, 'ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    initializeDatabase({ dbPath: path.join(dataDir, 'resume.db') });
    addWorkspace({ id: 'workspace_events', path: workspaceDir, name: 'events' });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: onMessagePersisted,
    });
    conversation.createThread({
      id: 'thread_events',
      workspace_id: 'workspace_events',
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
    memory.injectMemoryIntoMessages.mockClear();
    memory.injectMemoryIntoMessages.mockImplementation((messages: unknown[]) => messages);
    coordinator = createThreadStreamCoordinator();
  });

  it('a restart-recovered resume rebuilds history from the session log alone', async () => {
    const approvalsA = buildApprovals();
    const approvalId = await pauseOnWriteFile(buildStreaming(approvalsA), 121);

    // A restart: fresh approvals registry, and both old projections are gone.
    const approvalsB = buildApprovals();
    getDb().exec('DELETE FROM agent_runs');
    getDb().exec('DELETE FROM chat_messages');

    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('resumed from events')]));
    const chunks: string[] = [];
    const result = await approvalsB.approveTool(
      {
        id: 122,
        send: (channel, value) => {
          const chunk = value as { type?: string };
          if (channel === 'chat:ui-chunk') chunks.push(chunk.type ?? '');
        },
      },
      approvalId,
      true
    );

    expect(result).toMatchObject({
      success: true,
      awaitingApproval: false,
      threadId: 'thread_events',
      text: 'resumed from events',
    });
    expect(chunks).toContain('finish');
    // The approved call executed against the workspace exactly once.
    const written = await fs.readFile(path.join(workspaceDir, 'resume_events.txt'), 'utf8');
    expect(written).toContain('resumed');

    // Replay carries the whole story: input, pause partial, decision,
    // continuation output — even with both projections deleted.
    const view = rebuildThreadViewFromEvents('thread_events');
    expect(view.approvals.find(approval => approval.approvalId === approvalId)).toMatchObject({
      status: 'approved',
    });
    const completed = view.turns.filter(turn => turn.status === 'completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(view.messages)).toContain('resumed from events');
  });

  it('a resume whose approvals the session log never recorded is refused', async () => {
    // Legacy shape: approval rows exist, but the thread has no recorded
    // facts (pre-session-log data). A replay-only world cannot explain what
    // the user would be approving — the resume refuses loudly instead of
    // silently degrading to another authority.
    const approvals = buildApprovals();
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('should not run')]));
    const result = await approvals.approveTool({ id: 131, send: vi.fn() }, 'approval_unknown', true);
    expect(result.success).toBe(false);
    expect(createModelMock).not.toHaveBeenCalled();
  });

  it('a resume-started fact lost to a write failure releases the decision and fails the child run', async () => {
    const approvalsA = buildApprovals();
    const approvalId = await pauseOnWriteFile(buildStreaming(approvalsA), 141);

    const approvalsB = buildApprovals();
    getDb().exec(`CREATE TRIGGER resume_events_reject_started BEFORE INSERT ON session_events
      WHEN NEW.type = 'turn_started'
      BEGIN SELECT RAISE(ABORT, 'resume events: started write rejected'); END`);
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('written on retry')]));
    try {
      await expect(
        approvalsB.approveTool({ id: 142, send: vi.fn() }, approvalId, true)
      ).rejects.toThrow('Failed to append turn facts to the session log.');
    } finally {
      getDb().exec('DROP TRIGGER IF EXISTS resume_events_reject_started');
    }

    // The abandoned child run is failed, not running-forever — and its
    // terminal FACT is in the log (F1-review residual: the row alone would
    // dangle, since startup reclamation never revisits failed rows).
    const failedChild = agentRunDb
      .listAgentRunsByThread('thread_events')
      .find(run => run.status === 'failed' && run.kind === 'approval-resume');
    expect(failedChild).toBeDefined();
    const guardedView = rebuildThreadViewFromEvents('thread_events');
    expect(guardedView.turns.find(turn => turn.runId === failedChild!.id)).toMatchObject({
      status: 'failed',
    });

    // The decision was released: the retry walks the FULL path again. The
    // append-only log therefore may carry the decided fact twice (the user
    // genuinely decided twice) — replay converges by overwriting on the
    // approvalId, so every recorded decision must be the same approved one.
    const retryResult = await approvalsB.approveTool({ id: 143, send: vi.fn() }, approvalId, true);
    expect(retryResult).toMatchObject({ success: true, awaitingApproval: false });
    const view = rebuildThreadViewFromEvents('thread_events');
    const decided = view.events.filter(
      event =>
        event.type === APPROVAL_DECIDED &&
        (event.payload as { approvalId?: string }).approvalId === approvalId
    );
    expect(decided.length).toBeGreaterThanOrEqual(1);
    expect(
      decided.every(event => (event.payload as { approved?: boolean }).approved === true)
    ).toBe(true);
  });
});
