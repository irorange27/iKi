// @vitest-environment node

/**
 * ADR 008 unit F3: the frozen execution plan travels with the `turn_started`
 * fact, so a restart-recovered approval resume reads its plan from the session
 * log instead of `tool_call_approval_sessions.plan_json`.
 *
 * Why this is the F3 gate and not a formatting assertion: the plan column is
 * what the resume used to build the harness under. As long as the column was
 * the authority, the log could hold a complete turn and the resume would still
 * fail — the two stores disagreed about which one was load-bearing. The
 * discriminating shape is therefore "destroy the column, keep the log": if the
 * resume still rebuilds the turn, the log is the authority; if it degrades,
 * the column was.
 *
 * The control in the same file proves the assertion is not vacuous: a turn
 * whose `turn_started` fact predates the plan field (no `plan` in the payload)
 * MUST fall back, so the suite fails if the log path is silently bypassed.
 */
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

// The preparer is scripted so the test controls `skillMode` — the field that
// distinguishes a plan read from the log from a plan rebuilt by the legacy
// fallback (see pauseOnWriteFile).
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
import { onMessagePersisted } from '@iki/backend/thread_session/platform';
import { piTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { rebuildThreadViewFromEvents, TURN_STARTED } from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  onMessagePersisted: vi.fn(),
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

  /** Pause a turn on a write_file approval and return the approval id. */
  const pauseOnWriteFile = async (
    streaming: ReturnType<typeof createChatStreaming>,
    threadId: string,
    targetId: number,
    callId: string,
    fileName: string,
    skillMode: 'manual' | 'auto' = 'auto'
  ) => {
    // `skillMode: 'auto'` is the DISCRIMINATOR, not decoration. The legacy
    // fallback in approval.ts hardcodes `skillMode: 'manual'`, and the
    // approval-session row has no column for it, so 'auto' is a value ONLY the
    // recorded plan can carry. A test that used 'manual' would pass through the
    // fallback and prove nothing about the log path (verified by mutation: with
    // the replay lookup stubbed out, a 'manual' assertion still passed).
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
      onContinuityMessagePersisted: onMessagePersisted,
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
    // The FACT carries the plan — this is the write half of F3.
    expect((started!.payload as { plan?: unknown }).plan).toBeDefined();

    // And the replay surfaces it on the rebuilt turn, so a recovery consumer
    // does not have to re-read the raw event.
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

    // A restart, plus the aggressive half: destroy the plan column AND poison
    // the per-column fallback with a sentinel. Only the session log still knows
    // what this turn was.
    //
    // The sentinel is the discriminator. `tool_call_approval_sessions` carries
    // `system_prompt` as a COLUMN, so the legacy fallback would happily rebuild
    // the plan from it — that is exactly why the column-first read kept working
    // and why "delete the column" alone proved nothing (verified: with the
    // replay lookup stubbed out, a plain delete still resumed). Overwriting the
    // column with a value the real turn never used makes the two sources
    // observably different: if the resume reports the sentinel, it read the
    // column; if it reports the turn's real prompt, it read the log.
    const SENTINEL = 'POISONED-COLUMN-SYSTEM-PROMPT';
    const approvalsB = buildApprovals();
    getDb().exec('UPDATE tool_call_approval_sessions SET plan_json = NULL');
    getDb()
      .prepare('UPDATE tool_call_approval_sessions SET system_prompt = ? WHERE thread_id = ?')
      .run(SENTINEL, 'thread_f3');
    getDb().exec('DELETE FROM agent_runs');

    // Observe what the resumed turn runs under, at the model seam.
    let resumedSystemPrompt: string | undefined;
    let sawCall = false;
    callPiChatMock.mockImplementation(((
      model: unknown,
      context: unknown,
      options: unknown
    ) => {
      sawCall = true;
      // The seam's context carries the system prompt as a top-level field.
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

    // THE F3 ASSERTION: the resumed turn ran under the prompt the LOG holds,
    // not the sentinel the column was poisoned with.
    expect(sawCall).toBe(true);
    expect(resumedSystemPrompt).toBeDefined();
    expect(resumedSystemPrompt).not.toContain(SENTINEL);

    // The approved call executed exactly once against the workspace.
    const written = await fs.readFile(path.join(workspaceDir, 'f3_b.txt'), 'utf8');
    expect(written).toContain('resumed');
  });

  it('falls back for a turn whose fact predates the plan field', async () => {
    // Control: strip the plan from the recorded fact, simulating a pre-F3 row.
    // The resume must still work (via plan_json / the run row), which proves
    // the log path is additive rather than a hard dependency — and that this
    // suite would notice if the log path were silently bypassed.
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
