import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/backend/platform', () => ({ getUserDataPath: userDataMock }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  getFullSystemPrompt: () => 'audit system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { getChatThread } from '@iki/backend/db/chat_thread';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { startTurnHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';
import { resolveThreadWorkspaceSelectionSnapshot } from '@iki/backend/workspaces/thread_workspace';

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

  /** Pause a turn on a write_file approval, mirroring the streaming path's
   *  turn-start binding into the recovery context. */
  const pauseOnApproval = async (approvals: ReturnType<typeof createChatApproval>) => {
    const a = path.join(root, 'a');
    defaultToolRegistry.register(new WriteFileTool().toAgentTool());
    const tracker = {
      id: 'run_pause_probe',
    };
    const harness = startTurnHarness({
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
      modelFactory: () =>
        new FauxModelProvider([
          fauxToolCall('write_file', { path: 'approved.txt', content: 'audit' }, { id: 'call_probe' }),
        ]),
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
          approvals.registerApprovalBatch(requests, {
            target,
            history: harness.getHistory(),
            recoveryContext: {
              sessionId: 'assistant_probe',
              assistantMessageId: 'assistant_probe',
              threadId: 'thread_probe',
              runId: tracker.id,
              providerType: 'openai',
              model: 'audit',
              systemPrompt: `Current workspace: ${a}`,
              enabledTools: ['write_file'],
              availableSkillIds: [],
              approvalPolicy: 'always',
              maxIterations: 5,
              // What session_loop now records at turn start (D30 binding).
              workspaceSelection: resolveThreadWorkspaceSelectionSnapshot('thread_probe'),
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
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await fs.mkdir(a);
    await fs.mkdir(b);
    addWorkspace({ id: 'workspace_a', path: a, name: 'a' });
    addWorkspace({ id: 'workspace_wt_probe', path: b, name: 'b' });
    conversation = createChatPersistence({ memory: memory as never });
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

    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('done')]));
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
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('done')]));
    const resumeTarget = { id: 92, send: vi.fn() };
    expect(await recoveredApprovals.approveTool(resumeTarget, approvalId, true)).toMatchObject({
      success: true,
    });

    expect(await fs.readFile(path.join(a, 'approved.txt'), 'utf8')).toBe('audit');
    await expect(fs.stat(path.join(b, 'approved.txt'))).rejects.toThrow();
  });
});
