import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: () => profile.path }));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addWorkspace } from '@iki/backend/db/workspaces';
import {
  answerToolCallApproval,
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} from '@iki/backend/db/tool_call_approval';
import {
  appendSessionEvents,
  MESSAGE_EVENT_TYPES,
  SESSION_EVENT_VERSION,
} from '@iki/backend/db/session_events';
import { APPROVAL_REQUESTED } from '@iki/backend/thread_session/session_log';
import { recoverApprovalSession } from '@iki/backend/thread_session/approval_recovery';

const THREAD_ID = 'thread_recover_probe';
const RUN_ID = 'run_recover_probe';
const SESSION_ID = 'assistant_recover_probe';
const APPROVAL_ID = 'approval_recover_probe';

let root = '';

const seedSession = () => {
  upsertToolCallApprovalSession({
    session_id: SESSION_ID,
    thread_id: THREAD_ID,
    assistant_message_id: SESSION_ID,
    run_id: RUN_ID,
    provider_type: 'openai',
    provider_id: 'provider_probe',
    model: 'gpt-test',
    system_prompt: 'recovered system prompt',
    max_input_tokens: 128000,
    max_output_tokens: 4096,
    max_iterations: 20,
    enabled_tools: '["write_file"]',
    available_skill_ids: '[]',
    workspace_selection: null,
    plan_json: null,
  } as never);
};

const seedApproval = (state: 'pending' | 'answered' | 'consumed') => {
  upsertToolCallApprovals([
    {
      approval_id: APPROVAL_ID,
      session_id: SESSION_ID,
      tool_call_id: 'call_recover_1',
      tool_name: 'write_file',
      tool_args: '{"path":"a.txt"}',
      state,
    } as never,
  ]);
};

const seedLog = () => {
  appendSessionEvents(THREAD_ID, 0, [
    {
      type: MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        runId: RUN_ID,
        messageId: SESSION_ID,
        message: {
          id: SESSION_ID,
          role: 'assistant',
          parts: [{ type: 'text', text: 'writing now', state: 'done' }],
        },
        transport: 'stream',
      },
    },
    {
      type: APPROVAL_REQUESTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        approvalId: APPROVAL_ID,
        sessionId: SESSION_ID,
        runId: RUN_ID,
        toolCallId: 'call_recover_1',
        toolName: 'write_file',
        args: { path: 'a.txt' },
      },
    },
  ]);
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-recover-'));
  profile.path = root;
  initializeDatabase();
  addWorkspace({ id: 'ws_recover', path: root, name: 'Recover' });
  addChatThread({
    id: THREAD_ID,
    title: 'Recover',
    workspace_id: 'ws_recover',
    metadata: '{}',
    is_generating: 0,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  } as never);
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('recoverApprovalSession', () => {
  it('rebuilds the plan, history, and pending ids from the log', async () => {
    seedSession();
    seedApproval('pending');
    seedLog();

    const recovered = await recoverApprovalSession(APPROVAL_ID);

    expect(recovered).not.toBeNull();
    expect(recovered!.sessionId).toBe(SESSION_ID);
    expect([...recovered!.pendingApprovalIds]).toEqual([APPROVAL_ID]);
    expect(recovered!.collectedApprovalResponses.size).toBe(0);
    expect(recovered!.history.length).toBeGreaterThan(0);
    expect(recovered!.recoveryContext.plan.model).toBe('gpt-test');
    expect(recovered!.recoveryContext.plan.threadId).toBe(THREAD_ID);
    expect(recovered!.recoveryContext.plan.maxInputTokens).toBe(128000);
    expect(recovered!.recoveryContext.plan.enabledTools).toEqual(['write_file']);
    expect(recovered!.recoveryContext.plan.transport).toBe('approval-resume');
    expect(recovered!.recoveryContext.runId).toBe(RUN_ID);
  });

  // A consumed approval is excluded by getActiveToolCallApprovalsBySession, so the
  // session-level query is what refuses it; there is no separate state check.
  it('refuses when the approval was already consumed', async () => {
    seedSession();
    seedApproval('consumed');
    seedLog();

    expect(await recoverApprovalSession(APPROVAL_ID)).toBeNull();
  });

  it('refuses when the log never recorded the pending approval', async () => {
    seedSession();
    seedApproval('pending');

    expect(await recoverApprovalSession(APPROVAL_ID)).toBeNull();
  });

  it('refuses when the log has history but does not record this approval', async () => {
    seedSession();
    seedApproval('pending');
    // History exists, but the approval event carries a different id: the log
    // cannot prove this approval belongs to the history it would resume on.
    appendSessionEvents(THREAD_ID, 0, [
      {
        type: MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: RUN_ID,
          messageId: SESSION_ID,
          message: {
            id: SESSION_ID,
            role: 'assistant',
            parts: [{ type: 'text', text: 'writing now', state: 'done' }],
          },
          transport: 'stream',
        },
      },
      {
        type: APPROVAL_REQUESTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          approvalId: 'approval_someone_else',
          sessionId: SESSION_ID,
          runId: RUN_ID,
          toolCallId: 'call_recover_1',
          toolName: 'write_file',
          args: { path: 'a.txt' },
        },
      },
    ]);

    expect(await recoverApprovalSession(APPROVAL_ID)).toBeNull();
  });

  it('refuses when an active approval in the session has no log event', async () => {
    seedSession();
    seedApproval('pending');
    // A second active approval the log never saw: resuming on the recorded
    // history would silently drop it, so recovery must refuse the whole session.
    upsertToolCallApprovals([
      {
        approval_id: 'approval_sibling',
        session_id: SESSION_ID,
        tool_call_id: 'call_recover_2',
        tool_name: 'write_file',
        tool_args: '{"path":"b.txt"}',
        state: 'pending',
      } as never,
    ]);
    seedLog();

    expect(await recoverApprovalSession(APPROVAL_ID)).toBeNull();
  });

  it('keeps an answered approval pending in the set and carries its decision', async () => {
    seedSession();
    seedApproval('pending');
    seedLog();
    answerToolCallApproval(APPROVAL_ID, 'approved', 'ok');

    const recovered = await recoverApprovalSession(APPROVAL_ID);

    expect(recovered).not.toBeNull();
    expect([...recovered!.pendingApprovalIds]).toEqual([APPROVAL_ID]);
    expect(recovered!.collectedApprovalResponses.get(APPROVAL_ID)).toMatchObject({
      approved: true,
      reason: 'ok',
    });
  });

  it('collects the decision of an answered approval instead of re-asking', async () => {
    seedSession();
    seedApproval('pending');
    seedLog();
    answerToolCallApproval(APPROVAL_ID, 'rejected', 'not this file');

    const recovered = await recoverApprovalSession(APPROVAL_ID);

    expect(recovered).not.toBeNull();
    expect(recovered!.collectedApprovalResponses.get(APPROVAL_ID)).toMatchObject({
      approvalId: APPROVAL_ID,
      approved: false,
      reason: 'not this file',
    });
  });

  it('returns null for blank input rather than throwing', async () => {
    expect(await recoverApprovalSession('')).toBeNull();
    expect(await recoverApprovalSession('   ')).toBeNull();
  });
});
