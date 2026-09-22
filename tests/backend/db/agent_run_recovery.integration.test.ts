// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

const database = await import('@iki/backend/db/database');
const { getDb } = await import('@iki/backend/db/database');
const { createAgentRun, getAgentRun, recoverStuckRunsOnStartup } = await import(
  '@iki/backend/db/agent_runs'
);
const {
  getToolCallApproval,
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} = await import('@iki/backend/db/tool_call_approval');
const { addChatMessage, getChatMessages } = await import('@iki/backend/db/chat_message');
const { toModelInputMessages } = await import('@iki/backend/thread_session/ui_messages');
const {
  APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT,
  TOOL_INTERRUPTED_ERROR_TEXT,
} = await import('@iki/backend/message/tool_parts');

let dataDir = '';

const now = () => new Date().toISOString();

const seedThread = (threadId: string) => {
  getDb()
    .prepare(
      `INSERT INTO chat_threads (id, title, metadata, created_at, updated_at)
       VALUES (?, ?, '{}', ?, ?)`
    )
    .run(threadId, `recovery ${threadId}`, now(), now());
};

const seedRun = (runId: string, threadId: string, status: 'blocked' | 'completed') => {
  createAgentRun({
    id: runId,
    kind: 'chat-turn',
    status,
    threadId,
    rootRunId: runId,
    providerType: 'openai',
    model: 'test-model',
    systemPrompt: 'system prompt',
    input: {},
    working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
  } as never);
};

const seedMessage = (threadId: string, uiMessage: unknown) => {
  addChatMessage({
    id: (uiMessage as { id: string }).id,
    thread_id: threadId,
    message: JSON.stringify(uiMessage),
    timestamp: now(),
    metadata: '{}',
  });
};

const seedApproval = (params: {
  approvalId: string;
  sessionId: string;
  threadId: string;
  assistantMessageId: string;
  runId: string;
  toolCallId: string;
}) => {
  upsertToolCallApprovalSession({
    session_id: params.sessionId,
    thread_id: params.threadId,
    assistant_message_id: params.assistantMessageId,
    run_id: params.runId,
    provider_type: 'openai',
    model: 'test-model',
    system_prompt: 'system prompt',
    enabled_tools: '["shell"]',
    available_skill_ids: '[]',
  });
  upsertToolCallApprovals([
    {
      approval_id: params.approvalId,
      session_id: params.sessionId,
      tool_call_id: params.toolCallId,
      tool_name: 'shell',
      tool_args: '{}',
      state: 'pending',
    },
  ]);
};

const assistantUiMessage = {
  id: 'assistant_stuck',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolCallId: 'call_approval',
      toolName: 'shell',
      state: 'approval-requested',
      input: { command: 'ls' },
    },
    {
      type: 'dynamic-tool',
      toolCallId: 'call_midflight',
      toolName: 'write_file',
      state: 'input-available',
      input: { path: 'x.txt' },
    },
    {
      type: 'dynamic-tool',
      toolCallId: 'call_done',
      toolName: 'shell',
      state: 'output-available',
      input: {},
      output: 'ok',
    },
  ],
};

describe('recoverStuckRunsOnStartup tool-error reconciliation', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-run-recovery-'));
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });

    seedThread('thread_stuck');
    seedThread('thread_control');
    seedRun('run_stuck', 'thread_stuck', 'blocked');
    seedRun('run_control', 'thread_control', 'completed');

    seedMessage('thread_stuck', {
      id: 'user_stuck',
      role: 'user',
      parts: [{ type: 'text', text: 'run the shell probe' }],
    });
    seedMessage('thread_stuck', assistantUiMessage);

    seedMessage('thread_control', {
      id: 'user_control',
      role: 'user',
      parts: [{ type: 'text', text: 'control turn' }],
    });
    seedMessage('thread_control', {
      id: 'assistant_control',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call_control',
          toolName: 'shell',
          state: 'approval-requested',
          input: { command: 'pwd' },
        },
      ],
    });

    seedApproval({
      approvalId: 'appr_stuck',
      sessionId: 'assistant_stuck',
      threadId: 'thread_stuck',
      assistantMessageId: 'assistant_stuck',
      runId: 'run_stuck',
      toolCallId: 'call_approval',
    });
    seedApproval({
      approvalId: 'appr_control',
      sessionId: 'assistant_control',
      threadId: 'thread_control',
      assistantMessageId: 'assistant_control',
      runId: 'run_control',
      toolCallId: 'call_control',
    });
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('marks the killed run failed, expires only its approvals, and records terminal errors on its tool parts', () => {
    const result = recoverStuckRunsOnStartup();

    expect(result).toMatchObject({
      totalRuns: 1,
      blockedRuns: 1,
      failedRuns: 0,
      expiredApprovals: 1,
      interruptedToolParts: 2,
    });
    expect(getAgentRun('run_stuck')?.status).toBe('failed');
    // The pending card is closed as a system rejection with an explicit
    // reason (same shape as the approval-timeout path).
    expect(getToolCallApproval('appr_stuck')).toMatchObject({
      state: 'answered',
      decision: 'rejected',
    });
    expect(getToolCallApproval('appr_stuck')?.decision_reason).toContain('restarted');
    // A completed run's pending approval is out of scope — left answerable.
    expect(getToolCallApproval('appr_control')?.state).toBe('pending');

    const stuck = getChatMessages('thread_stuck').find(row => row.id === 'assistant_stuck');
    const parts = JSON.parse(stuck!.message).parts as Array<Record<string, unknown>>;
    const byCall = Object.fromEntries(parts.map(part => [part.toolCallId, part]));
    expect(byCall.call_approval).toMatchObject({
      state: 'output-error',
      errorText: APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT,
    });
    expect(byCall.call_midflight).toMatchObject({
      state: 'output-error',
      errorText: TOOL_INTERRUPTED_ERROR_TEXT,
    });
    // Terminal parts are untouched.
    expect(byCall.call_done).toMatchObject({ state: 'output-available' });

    // The control thread's part stays answerable (no zombie killing).
    const control = getChatMessages('thread_control').find(row => row.id === 'assistant_control');
    const controlParts = JSON.parse(control!.message).parts as Array<Record<string, unknown>>;
    expect(controlParts[0]).toMatchObject({ state: 'approval-requested' });

    // Idempotent: a second pass finds nothing left to reconcile.
    const second = recoverStuckRunsOnStartup();
    expect(second).toMatchObject({ totalRuns: 0, expiredApprovals: 0, interruptedToolParts: 0 });
  });

  it('feeds the recorded errors back to the model as paired tool results on the next turn', async () => {
    const rows = getChatMessages('thread_stuck');
    const uiMessages = rows.map(row => JSON.parse(row.message));

    const converted = await toModelInputMessages(uiMessages);

    const toolResults = converted.flatMap(message =>
      (Array.isArray(message.content) ? message.content : []).filter(
        part => part.type === 'tool-result'
      )
    ) as Array<{ toolCallId?: string; output?: unknown }>;
    const resultByCall = Object.fromEntries(
      toolResults.map(part => [part.toolCallId, part])
    );
    expect(JSON.stringify(resultByCall.call_approval?.output)).toContain('never executed');
    expect(JSON.stringify(resultByCall.call_midflight?.output)).toContain(
      'may or may not have taken effect'
    );

    // Pairing: every assistant tool-call has its tool result — the follow-up
    // request stays provider-valid and the loop can continue.
    const openToolCallIds = new Set<string>();
    for (const message of converted) {
      if (message.role === 'assistant') {
        for (const part of Array.isArray(message.content) ? message.content : []) {
          if (part.type === 'tool-call') openToolCallIds.add(part.toolCallId);
        }
      } else if (message.role === 'tool') {
        for (const part of Array.isArray(message.content) ? message.content : []) {
          if (part.type === 'tool-result') openToolCallIds.delete(part.toolCallId);
        }
      }
    }
    expect([...openToolCallIds]).toEqual([]);
  });
});
