import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: () => profile.path }));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createAgentRun } from '@iki/backend/db/agent_runs';
import {
  appendSessionEvents,
  MESSAGE_EVENT_TYPES,
  SESSION_EVENT_VERSION,
} from '@iki/backend/db/session_events';
import { recoverStuckRunsOnStartup } from '@iki/backend/thread_session/run_tracker';
import {
  APPROVAL_REQUESTED,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';

const THREAD_ID = 'thread_crash_pending';
const RUN_ID = 'run_crash_pending';
const SESSION_ID = 'assistant_crash_pending';
const TOOL_CALL_ID = 'call_pending_1';

let root = '';

const committedMessage = () => ({
  id: SESSION_ID,
  role: 'assistant',
  parts: [{ type: 'text', text: 'I will write the file now.', state: 'done' }],
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-crash-pending-'));
  profile.path = root;
  initializeDatabase();
  addWorkspace({ id: 'ws_crash_pending', path: root, name: 'Crash Pending' });
  addChatThread({
    id: THREAD_ID,
    title: 'Crash Pending',
    workspace_id: 'ws_crash_pending',
    metadata: '{}',
    is_generating: 0,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  } as never);

  // The crash window: the model committed its text, asked for approval, and the
  // process died before the tool call ever reached MODEL_OUTPUT_COMMITTED.
  appendSessionEvents(THREAD_ID, 0, [
    {
      type: MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        runId: RUN_ID,
        messageId: SESSION_ID,
        message: committedMessage(),
        transport: 'stream',
      },
    },
    {
      type: APPROVAL_REQUESTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        approvalId: 'approval_pending_1',
        sessionId: SESSION_ID,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        toolName: 'write_file',
        args: { path: 'e2e/hello.txt', content: 'x' },
      },
    },
  ]);

  createAgentRun({
    id: RUN_ID,
    kind: 'chat-turn',
    status: 'blocked',
    threadId: THREAD_ID,
    rootRunId: RUN_ID,
    providerType: 'openai',
    model: 'gpt-test',
    systemPrompt: 'test system',
    enabledTools: [],
    availableSkillIds: [],
    input: { prompt: '', messages: [], metadata: {} },
    working: {
      modelMessages: [],
      accumulatedText: '',
      pendingApprovalIds: [],
      lastStepIndex: 0,
    },
    output: null,
    error: null,
  } as never);
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('startup recovery of a call that crashed while approval was pending', () => {
  it('commits the interrupted call as a terminal error so the transcript is not left mid-call', () => {
    const before = rebuildThreadViewFromEvents(THREAD_ID);
    expect(before.messages).toHaveLength(1);
    expect(JSON.stringify(before.messages[0])).not.toContain('never executed');

    const result = recoverStuckRunsOnStartup();
    expect(result.blockedRuns).toBe(1);
    expect(result.interruptedToolParts).toBe(1);

    const after = rebuildThreadViewFromEvents(THREAD_ID);
    const parts = (after.messages[0] as { parts?: unknown[] }).parts ?? [];
    const toolPart = parts.find(
      (part): part is Record<string, unknown> =>
        typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'dynamic-tool'
    );
    expect(toolPart).toBeDefined();
    expect(toolPart).toMatchObject({
      toolCallId: TOOL_CALL_ID,
      toolName: 'write_file',
      state: 'output-error',
    });
    expect(String(toolPart?.errorText)).toContain('never executed');
  });

  it('does not commit a second terminal part on a repeated recovery pass', () => {
    recoverStuckRunsOnStartup();
    const second = recoverStuckRunsOnStartup();
    expect(second.interruptedToolParts).toBe(0);

    const after = rebuildThreadViewFromEvents(THREAD_ID);
    const parts = (after.messages[0] as { parts?: unknown[] }).parts ?? [];
    const toolParts = parts.filter(
      part =>
        typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'dynamic-tool'
    );
    expect(toolParts).toHaveLength(1);
  });
});
