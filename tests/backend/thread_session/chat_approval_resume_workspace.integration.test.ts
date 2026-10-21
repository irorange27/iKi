import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', () => ({ getUserDataPath: userDataMock }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'audit system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // No database in this suite: answer the provider lookup directly so the Pi
  // supply admits the turn (the address is never dialled — callPiChat is mocked).
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { getChatThread } from '@iki/backend/db/chat_thread';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { onMessagePersisted } from '@iki/backend/thread_session/platform';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

// F4: the thrown-error teardown of a cancelled resume must still land its
// terminal fact. The flag makes the FIRST terminal-bearing append fail once
// (as a real transient write failure would); the resolved-cancel tail then
// loses the fact and the catch's loud-guarded record must recover it — a
// regression that fails on the pre-F4 code, where only the tail recorded.
const sessionLogThrows = vi.hoisted(() => ({ failNextTerminal: false }));
vi.mock('@iki/backend/thread_session/session_log', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/thread_session/session_log')>();
  const TERMINALS = new Set(['turn_completed', 'turn_failed', 'turn_cancelled']);
  return {
    ...actual,
    recordSessionEvents: vi.fn((threadId: string, events: ReadonlyArray<{ type: string }>) => {
      // The failure targets the CANCEL TAIL — the terminal that lands when
      // the resumed turn unwinds. The resume's own start/parent-terminal
      // write also carries a terminal (the parent segment ends there), so
      // matching any terminal would hit that write first and change what
      // this case exercises.
      const startsATurn = events.some(event => event.type === 'turn_started');
      if (
        sessionLogThrows.failNextTerminal &&
        !startsATurn &&
        events.some(event => TERMINALS.has(event.type))
      ) {
        sessionLogThrows.failNextTerminal = false;
        throw new actual.SessionLogWriteError(threadId);
      }
      return actual.recordSessionEvents(threadId, events as never);
    }),
  };
});
import { resolveThreadWorkspaceSelectionSnapshot } from '@iki/backend/workspaces/thread_workspace';
import {
  MODEL_OUTPUT_COMMITTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// F1 boundary (D30): an approved action executes in the workspace the turn
// started in. Switching the thread's workspace while an approval is pending
// must not redirect the old action to the new selection — neither through the
// in-memory resume nor through a restart recovered from the approval rows.
describe('approval resume keeps the turn-start workspace', () => {
  let root: string;
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;

  const buildApprovals = (
    coordinatorOverride?: ReturnType<typeof createThreadStreamCoordinator>,
    memoryOverride?: typeof memory
  ) =>
    createChatApproval({
      streams: {
        tryAcquireThreadRun: (coordinatorOverride ?? coordinator).tryAcquireThreadRun,
        peek: (coordinatorOverride ?? coordinator).peekStream,
        attach: (coordinatorOverride ?? coordinator).attachStream,
        detach: (coordinatorOverride ?? coordinator).detachStream,
      },
      memory: (memoryOverride ?? memory) as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
    });

  /** Pause a turn on a write_file approval, mirroring the streaming path's
   *  turn-start binding into the recovery context. */
  const pauseOnApproval = async (approvals: ReturnType<typeof createChatApproval>) => {
    const a = path.join(root, 'a');
    // The model asks for the gated write; the harness executes it on resume.
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: 'write_file',
            args: { path: 'approved.txt', content: 'audit' },
            id: 'call_probe',
          },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );
    defaultToolRegistry.register(new WriteFileTool().toAgentTool());
    const tracker = {
      id: 'run_pause_probe',
    };
    const harness = startPiTurnHarness({
      providerType: 'openai',
      model: 'audit',
      systemPrompt: `Current workspace: ${a}`,
      enableTools: true,
      enabledToolNames: ['write_file'],
      availableSkillIds: [],
      guardActive: false,
      approvalPolicy: 'always',
      maxIterations: 5,
      threadId: 'thread_probe',
    });
    let approvalId = '';
    const target = { id: 91, send: vi.fn() };
    await runWithToolRuntimeContext({ threadId: 'thread_probe', runId: tracker.id }, async () => {
      for await (const event of harness.turn({ prompt: 'write in a' })) {
        if (event.event === 'done') {
          const requests = event.output.toolApprovalRequests;
          if (!requests?.length) throw new Error('Probe did not receive an approval request');
          approvalId = requests[0].approvalId;
          // What the streaming path persists while approval-pending: the
          // partial assistant row carries the live approval-request part the
          // resume pairs the decision with.
          conversation.createMessage({
            id: 'assistant_probe',
            thread_id: 'thread_probe',
            message: {
              id: 'assistant_probe',
              role: 'assistant',
              parts: [
                {
                  type: 'dynamic-tool',
                  toolCallId: 'call_probe',
                  toolName: 'write_file',
                  state: 'approval-requested',
                  // Schema-validated form (encoding default applied). Known
                  // separate defect: a real paused row carries the RAW model
                  // args and the SDK's approved-input deep-equal then rejects
                  // the recovery for schemas with defaults — tracked as an
                  // A-stage follow-up, unrelated to the workspace binding
                  // under test here.
                  input: { path: 'approved.txt', content: 'audit', encoding: 'utf-8' },
                  approval: { id: approvalId },
                },
              ],
            },
          });
          // F2: the restart-recovery history source is the session log — the
          // pause records its partial output as a fact, exactly what the
          // streaming entry does in production.
          recordSessionEvents('thread_probe', [
            {
              type: MODEL_OUTPUT_COMMITTED,
              version: SESSION_EVENT_VERSION,
              payload: {
                runId: tracker.id,
                messageId: 'assistant_probe',
                message: {
                  id: 'assistant_probe',
                  role: 'assistant',
                  parts: [
                    {
                      type: 'dynamic-tool',
                      toolCallId: 'call_probe',
                      toolName: 'write_file',
                      state: 'approval-requested',
                      input: { path: 'approved.txt', content: 'audit', encoding: 'utf-8' },
                      approval: { id: approvalId },
                    },
                  ],
                } as never,
                transport: 'stream',
              },
            },
          ]);
          approvals.registerApprovalBatch(requests, {
            target,
            history: harness.getHistory(),
            recoveryContext: {
              // What session_loop assembles at turn start: the plan (with the
              // D30 workspace binding) plus the pause identities.
              plan: {
                providerType: 'openai',
                model: 'audit',
                enableTools: true,
                enabledTools: ['write_file'],
                availableSkillIds: [],
                guardActive: false,
                requireApproval: true,
                autoApproveToolRequests: false,
                approvalPolicy: 'always',
                budget: { step: 5 },
                systemPrompt: `Current workspace: ${a}`,
                skillMode: 'manual',
                kind: 'chat-turn',
                runMetadata: {},
                transport: 'stream',
                threadId: 'thread_probe',
                // What session_loop now records at turn start (D30 binding).
                workspaceSelection: resolveThreadWorkspaceSelectionSnapshot('thread_probe'),
              },
              sessionId: 'assistant_probe',
              assistantMessageId: 'assistant_probe',
              runId: tracker.id,
            },
          });
        }
      }
    });
    return { approvalId, target };
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-workspace-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'audit.db') });
    // The resumed segment resolves its plan through the provider table; seed the
    // row the plan names so the Pi supply admits it (callPiChat is mocked, so
    // the address is never dialled).
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'audit' });
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await fs.mkdir(a);
    await fs.mkdir(b);
    addWorkspace({ id: 'workspace_a', path: a, name: 'a' });
    addWorkspace({ id: 'workspace_wt_probe', path: b, name: 'b' });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: onMessagePersisted,
    });
    conversation.createThread({
      id: 'thread_probe',
      workspace_id: 'workspace_a',
      metadata: '{"mode":"work"}',
    });
    conversation.createMessage({
      id: 'user_probe',
      thread_id: 'thread_probe',
      message: { role: 'user', parts: [{ type: 'text', text: 'write in a' }] },
    });
    coordinator = createThreadStreamCoordinator();
  });

  afterEach(async () => {
    defaultToolRegistry.remove('write_file');
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('executes the approved write in workspace A after the thread switched to B', async () => {
    const approvals = buildApprovals();
    const { approvalId, target } = await pauseOnApproval(approvals);
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');

    conversation.updateThread('thread_probe', { workspace_id: 'workspace_wt_probe' });
    expect(getChatThread('thread_probe')?.workspace_id).toBe('workspace_wt_probe');

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    expect(await approvals.approveTool(target, approvalId, true)).toMatchObject({
      success: true,
    });

    expect(await fs.readFile(path.join(a, 'approved.txt'), 'utf8')).toBe('audit');
    await expect(fs.stat(path.join(b, 'approved.txt'))).rejects.toThrow();
  });

  it('recovers the same binding from the approval rows after a restart', async () => {
    const approvals = buildApprovals();
    const { approvalId } = await pauseOnApproval(approvals);
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');

    conversation.updateThread('thread_probe', { workspace_id: 'workspace_wt_probe' });
    // The binding survives with the session row.
    const session = toolCallApprovalDb.getToolCallApprovalSession('assistant_probe');
    expect(session?.workspace_selection).toContain('workspace_a');

    // Simulate the restart: a fresh approvals registry with no in-memory state.
    const recoveredApprovals = buildApprovals();
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const resumeTarget = { id: 92, send: vi.fn() };
    expect(await recoveredApprovals.approveTool(resumeTarget, approvalId, true)).toMatchObject({
      success: true,
    });

    expect(await fs.readFile(path.join(a, 'approved.txt'), 'utf8')).toBe('audit');
    await expect(fs.stat(path.join(b, 'approved.txt'))).rejects.toThrow();
  });
});
