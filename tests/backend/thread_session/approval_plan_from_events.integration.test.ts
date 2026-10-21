// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const prepareChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: prepareChatTurnMock,
  }),
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'f3 system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { piTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { rebuildThreadViewFromEvents, TURN_STARTED } from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

describe('F3: the approval resume reads its plan from the session log', () => {
  let dataDir = '';
  let workspaceDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;

  const preparedTurn = {
    report: { totalEstimatedTokens: 1, blocks: [] },
    usedSkills: [],
    selectedSkillIds: [],
    skillMode: 'manual' as const,
    finalMessages: [{ role: 'user' as const, content: 'write it' }],
    history: [] as unknown[],
    prompt: 'write it',
    guardActive: false,
    requireApproval: true,
    autoApproveToolRequests: false,
    affectSignal: null,
    interventionPolicy: null,
    guardedTools: ['write_file'],
    enableTools: true,
  };

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
      getThreadTitle: () => 'F3',
    });

  
  const pauseOnWriteFile = async (
    streaming: ReturnType<typeof createChatStreaming>,
    threadId: string,
    targetId: number,
    callId: string,
    fileName: string,
    skillMode: 'manual' | 'auto' = 'auto'
  ) => {
    prepareChatTurnMock.mockResolvedValue({ ...preparedTurn, skillMode });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: 'write_file',
            args: { path: fileName, content: 'resumed' },
            id: callId,
          },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );
    const pauseResult = await streaming.stream(
      { id: targetId, send: vi.fn() },
      {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'test-model',
        threadId,
        approvalPolicy: 'always',
        messages: [
          {
            id: `msg_${threadId}_${targetId}`,
            role: 'user',
            parts: [{ type: 'text', text: 'write it' }],
          },
        ],
        tools: ['write_file'],
      }
    );
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });
    return rebuildThreadViewFromEvents(threadId).approvals.at(-1)!.approvalId;
  };

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-f3-plan-'));
    workspaceDir = path.join(dataDir, 'ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    initializeDatabase({ dbPath: path.join(dataDir, 'f3.db') });
    seedTurnProvider({ providerId: 'provider_primary', model: 'test-model' });
    addWorkspace({ id: 'workspace_f3', path: workspaceDir, name: 'f3' });
    conversation = createChatPersistence({
      memory: memory as never,
    });
    conversation.createThread({
      id: 'thread_f3',
      workspace_id: 'workspace_f3',
      metadata: '{"mode":"work"}',
    });
    conversation.createThread({
      id: 'thread_f3_control',
      workspace_id: 'workspace_f3',
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
    prepareChatTurnMock.mockResolvedValue(preparedTurn);
    memory.injectMemoryIntoMessages.mockClear();
    memory.injectMemoryIntoMessages.mockImplementation((messages: unknown[]) => messages);
    coordinator = createThreadStreamCoordinator();
  });

  it('records the plan on the turn_started fact', async () => {
    const approvalsA = buildApprovals();
    await pauseOnWriteFile(buildStreaming(approvalsA), 'thread_f3', 201, 'call_f3_a', 'f3_a.txt');

    const view = rebuildThreadViewFromEvents('thread_f3');
    const started = view.events.find(event => event.type === TURN_STARTED);
    expect(started).toBeDefined();
    expect((started!.payload as { plan?: unknown }).plan).toBeDefined();

    const turnWithPlan = view.turns.find(turn => turn.plan !== undefined);
    expect(turnWithPlan).toBeDefined();
    expect(turnWithPlan!.plan).toMatchObject({
      providerType: 'openai',
      model: 'test-model',
      enableTools: true,
    });
  });

  it('resumes correctly after the plan column is destroyed', async () => {
    const approvalsA = buildApprovals();
    const approvalId = await pauseOnWriteFile(
      buildStreaming(approvalsA),
      'thread_f3',
      202,
      'call_f3_b',
      'f3_b.txt',
      'auto'
    );

    const SENTINEL = 'POISONED-COLUMN-SYSTEM-PROMPT';
    const approvalsB = buildApprovals();
    getDb().exec('UPDATE tool_call_approval_sessions SET plan_json = NULL');
    getDb()
      .prepare('UPDATE tool_call_approval_sessions SET system_prompt = ? WHERE thread_id = ?')
      .run(SENTINEL, 'thread_f3');
    getDb().exec('DELETE FROM agent_runs');

    let resumedSystemPrompt: string | undefined;
    let sawCall = false;
    callPiChatMock.mockImplementation(((
      model: unknown,
      context: unknown,
      options: unknown
    ) => {
      sawCall = true;
      const captured = context as { systemPrompt?: unknown };
      if (typeof captured.systemPrompt === 'string') resumedSystemPrompt = captured.systemPrompt;
      const scripted = createScriptedPiChat([
        [
          { kind: 'text', text: 'resumed from the log plan' },
          { kind: 'done', reason: 'stop' },
        ],
      ]);
      return (scripted as (m: unknown, c: unknown, o: unknown) => unknown)(model, context, options);
    }) as never);

    const result = await approvalsB.approveTool({ id: 203, send: vi.fn() }, approvalId, true);
    expect(result).toMatchObject({ success: true, awaitingApproval: false });

    expect(sawCall).toBe(true);
    expect(resumedSystemPrompt).toBeDefined();
    expect(resumedSystemPrompt).not.toContain(SENTINEL);

    const written = await fs.readFile(path.join(workspaceDir, 'f3_b.txt'), 'utf8');
    expect(written).toContain('resumed');
  });

  it('falls back for a turn whose fact predates the plan field', async () => {
    const approvalsA = buildApprovals();
    const approvalId = await pauseOnWriteFile(
      buildStreaming(approvalsA),
      'thread_f3_control',
      211,
      'call_f3_control',
      'f3_control.txt'
    );

    const rows = getDb()
      .prepare("SELECT id, payload FROM session_events WHERE thread_id = ? AND type = ?")
      .all('thread_f3_control', TURN_STARTED) as Array<{ id: number; payload: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      delete payload.plan;
      getDb()
        .prepare('UPDATE session_events SET payload = ? WHERE id = ?')
        .run(JSON.stringify(payload), row.id);
    }

    const view = rebuildThreadViewFromEvents('thread_f3_control');
    expect(view.turns.every(turn => turn.plan === undefined)).toBe(true);

    const approvalsB = buildApprovals();
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'resumed via fallback' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const result = await approvalsB.approveTool({ id: 212, send: vi.fn() }, approvalId, true);
    expect(result).toMatchObject({ success: true, awaitingApproval: false });
    expect(result).toMatchObject({ text: 'resumed via fallback' });
  });
});
