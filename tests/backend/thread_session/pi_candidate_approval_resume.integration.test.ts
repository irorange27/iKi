// @vitest-environment node

/**
 * The real approval entry records decisions; the backend tool-execution owner
 * binds actions and observations in Session log. The candidate only constructs
 * provider requests. Its registration deliberately omits recoveryContext so
 * the existing AI SDK continuation does not also execute the action.
 * Full Pi turn/approval wiring remains a separate integration boundary.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import {
  getToolCallApproval,
  getToolCallApprovalSession,
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} from '@iki/backend/db/tool_call_approval';
import {
  createChatApproval,
  executeApprovedTool,
  prepareToolExecution,
} from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createTool } from '@iki/backend/tools';
import { z } from 'zod';

import { callModel, createScriptedModel } from '../pi_candidate/helpers/candidate';
import { projectHistoryToPiContext } from '@iki/backend/provider/llm/pi_adapter';
import {
  getSessionEvents,
  appendSessionEvents,
  getSessionEventRevision,
} from '@iki/backend/db/session_events';
import {
  TOOL_EXECUTION_STARTED,
  TOOL_EXECUTION_FINISHED,
} from '@iki/backend/thread_session/tool_execution';
import {
  createScriptedPiServer,
  sse,
  type ScriptedPiServer,
} from '../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
const model = buildLazyModel();
function buildLazyModel() {
  return createScriptedModel(0); // baseUrl patched after the server binds
}

const memory = {
  onMessagePersisted: () => undefined,
  injectMemoryIntoMessages: (messages: unknown[]) => messages,
  getAffectContextMessage: () => '',
};

// The candidate's real tool: the only effect executor in this experiment.
const executions: string[] = [];
const readFileTool = createTool({
  name: 'read_file',
  type: 'fs',
  description: 'Read a file',
  paramSchema: z.object({ path: z.string() }),
  handler: async args => {
    executions.push(`read_file:${args.path}`);
    return { content: `contents of ${args.path}` };
  },
});

// The candidate owns provider dispatch only. Admission, observations and
// duplicate execution are handled by the backend action owner, in Session log.
const candidateResume = async (approvalId: string) => {
  const approval = getToolCallApproval(approvalId)!;
  const threadId = getToolCallApprovalSession(approval.session_id)!.thread_id;
  const controller = new AbortController();
  const release = coordinator.tryAcquireThreadRun(threadId, {
    onExecutionAbort: () => controller.abort(),
  });
  if (!release) return { kind: 'busy' as const };
  try {
    const outcome = await executeApprovedTool(
      { threadId, approvalId },
      {
        signal: controller.signal,
        execute: (toolName, args) => {
          expect(toolName).toBe(readFileTool.name);
          return readFileTool.handler(args);
        },
      }
    );
    if (outcome.kind === 'pending') return { kind: 'refused', reason: 'decision pending' };
    if (outcome.kind !== 'completed') return outcome;
    const toolResultText = JSON.stringify(outcome.result.output);
    const context = projectHistoryToPiContext(
      [
        { role: 'user', content: `probe-${approvalId}` },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: approval.tool_call_id!,
              toolName: approval.tool_name!,
              input: JSON.parse(approval.tool_args ?? '{}'),
            },
          ],
        },
        { role: 'tool', content: [outcome.result] },
      ],
      model.id
    );
    controller.signal.throwIfAborted();
    const { final } = await callModel(model, context, { signal: controller.signal });
    expect(final.stopReason).toBe('stop');
    return {
      kind: approval.decision === 'approved' ? 'executed' : 'rejected',
      reused: outcome.reused,
      toolResultText,
      wireText: JSON.stringify(final.content),
    };
  } finally {
    release();
  }
};

// ── real owner registration helper ──────────────────────────────────────────
let approvals: ReturnType<typeof createChatApproval>;
let coordinator: ReturnType<typeof createThreadStreamCoordinator>;
let conversation: ReturnType<typeof createChatPersistence>;
const registerPendingApproval = (
  id: string,
  sessionId: string,
  threadId: string,
  callId: string,
  argsPath: string,
  candidate = true
) => {
  addChatThread({
    id: threadId,
    title: 'approval',
    metadata: '{}',
    is_generating: false,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  });
  upsertToolCallApprovalSession({
    session_id: sessionId,
    thread_id: threadId,
    assistant_message_id: `msg_${id}`,
    provider_type: 'openai',
    model: 'scripted-model',
    system_prompt: 'candidate',
    max_input_tokens: 100000,
    max_output_tokens: 2000,
    max_iterations: 1,
    enabled_tools: '[]',
    available_skill_ids: '[]',
  });
  upsertToolCallApprovals([
    {
      approval_id: id,
      session_id: sessionId,
      tool_call_id: callId,
      tool_name: 'read_file',
      tool_args: JSON.stringify({ path: argsPath }),
      state: 'pending',
    },
  ]);
  // The REAL owner registration primitive — the same one session_loop calls
  // when a turn pauses. No recovery context: the harness continuation is out
  // of scope for the bounded experiment (it declines; see the module doc).
  approvals.ensurePendingApprovalSession(id, {
    target: { id: 900 + id.length, send: vi.fn() },
  });
  if (candidate) prepareToolExecution({ threadId, approvalId: id });
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-approval-'));
  initializeDatabase({ dbPath: path.join(root, 'approval-resume.db') });
  server = await createScriptedPiServer();
  model.baseUrl = `http://127.0.0.1:${server.port}/v1`;

  coordinator = createThreadStreamCoordinator();
  conversation = createChatPersistence({
    memory: memory as never,
    onContinuityMessagePersisted: async () => undefined,
  });
  approvals = createChatApproval({
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

  server.setScript('probe-appr_ok', { chunks: [sse.delta('resumed ok'), sse.finish('stop')] });
});

afterAll(async () => {
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('approval resume through the real owner with the candidate executor', () => {
  it('pending: no decision — the candidate refuses and no effect runs', async () => {
    registerPendingApproval('appr_pending', 'sess_pending', 'thread_pending', 'call_p', '/p.txt');
    const outcome = await candidateResume('appr_pending');
    expect(outcome).toEqual({ kind: 'refused', reason: 'decision pending' });
    expect(executions).toEqual([]);
  });

  it('approved: the real owner records the decision; the candidate executes exactly once and the wire carries the result', async () => {
    executions.length = 0;
    registerPendingApproval('appr_ok', 'sess_ok', 'thread_ok', 'call_ok', '/approved.txt');

    // The REAL decision entry. Its resume continuation declines (no recovery
    // context — the harness is not registered in this bounded experiment),
    // the durable decision is recorded; the legacy continuation remains out of scope.
    await approvals.approveTool({ id: 901, send: vi.fn() }, 'appr_ok', true, 'user approved');
    expect(getToolCallApproval('appr_ok')).toMatchObject({
      state: 'answered',
      decision: 'approved',
    });

    const outcome = await candidateResume('appr_ok');
    expect(outcome.kind).toBe('executed');
    expect(executions).toEqual(['read_file:/approved.txt']);
    if (outcome.kind !== 'executed') return;
    expect(outcome.wireText).toContain('resumed ok'); // scripted reply round-tripped
    // The tool result was CARRIED: the server-side capture of request 1 holds it.
    const wire = server.getWire('probe-appr_ok');
    expect(JSON.stringify(wire.messages)).toContain('/approved.txt');
    expect(JSON.stringify(wire.messages)).toContain('contents of');
  });

  it('duplicate: a second resume over the same approval never re-executes', async () => {
    const outcome = await candidateResume('appr_ok');
    expect(outcome).toMatchObject({ kind: 'executed', reused: true });
    expect(outcome.toolResultText).toContain('contents of /approved.txt');
    expect(executions).toEqual(['read_file:/approved.txt']);
  });

  it('rejected: no effect; the model sees an explicit error result', async () => {
    executions.length = 0;
    registerPendingApproval('appr_rej', 'sess_rej', 'thread_rej', 'call_rej', '/rejected.txt');
    server.setScript('probe-appr_rej', { chunks: [sse.delta('understood'), sse.finish('stop')] });
    await approvals.approveTool({ id: 902, send: vi.fn() }, 'appr_rej', false, 'user denied');
    const outcome = await candidateResume('appr_rej');
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.wireText).toContain('understood');
    // The denial was CARRIED as an error result on the wire.
    const wire = server.getWire('probe-appr_rej');
    const wireToolResult = (
      wire.messages as Array<{ role: string; content?: string | Array<{ text?: string }> }>
    ).find(m => m.role === 'tool');
    const denialText =
      typeof wireToolResult?.content === 'string'
        ? wireToolResult.content
        : (wireToolResult?.content?.[0]?.text ?? '');
    expect(denialText).toContain('user denied');
    expect(executions).toEqual([]);
  });

  it('duplicate decision after completion: post-completion decline, no new effect', async () => {
    executions.length = 0;
    const again = await approvals.approveTool(
      { id: 903, send: vi.fn() },
      'appr_ok',
      true,
      'user approved'
    );
    // The owner's idempotent branch exists only while the batch session is
    // registered; after completion a re-approve declines — the durable
    // decision is untouched and no effect runs.
    expect(again.success).toBe(false);
    // The decision and completed observation are separate durable facts.
    expect(getToolCallApproval('appr_ok')).toMatchObject({
      state: 'answered',
      decision: 'approved',
    });
    expect(getSessionEvents('thread_ok', [TOOL_EXECUTION_FINISHED]).length).toBe(1);
    expect(executions).toEqual([]);
  });

  it('owner-consumed rows read as authorized (the flip-time shape, pinned)', async () => {
    executions.length = 0;
    registerPendingApproval('appr_oc', 'sess_oc', 'thread_oc', 'call_oc', '/owner-consumed.txt');
    await approvals.approveTool({ id: 906, send: vi.fn() }, 'appr_oc', true, 'user approved');
    // The flip-time shape: the OWNER consumes (recoveryContext present) and
    // the candidate starts with no journal intent of its own.
    getDb()
      .prepare("UPDATE tool_call_approvals SET state = 'consumed' WHERE approval_id = 'appr_oc'")
      .run();
    expect(getToolCallApproval('appr_oc')).toMatchObject({
      state: 'consumed',
      decision: 'approved',
    });
    expect(getSessionEvents('thread_oc', [TOOL_EXECUTION_STARTED])).toEqual([]);
    server.setScript('probe-appr_oc', { chunks: [sse.delta('owner resumed'), sse.finish('stop')] });

    const outcome = await candidateResume('appr_oc');
    expect(outcome.kind).toBe('executed');
    expect(executions).toEqual(['read_file:/owner-consumed.txt']);
  });

  it('concurrent resumes: the atomic claim lets exactly one execute', async () => {
    executions.length = 0;
    registerPendingApproval(
      'appr_conc',
      'sess_conc',
      'thread_conc',
      'call_conc',
      '/concurrent.txt'
    );
    await approvals.approveTool({ id: 905, send: vi.fn() }, 'appr_conc', true, 'user approved');

    server.setScript('probe-appr_conc', {
      chunks: [sse.delta('concurrent resumed'), sse.finish('stop')],
    });
    const [a, b] = await Promise.all([candidateResume('appr_conc'), candidateResume('appr_conc')]);
    const kinds = [a.kind, b.kind].sort();
    // Turn admission keeps duplicate continuation requests out of the provider.
    expect(kinds).toEqual(['busy', 'executed']);
    expect(server.countRequests('probe-appr_conc')).toBe(1);
    expect(executions).toEqual(['read_file:/concurrent.txt']);
  });

  it('unknown: a journal entry with effect-start but no result refuses blind replay', async () => {
    executions.length = 0;
    registerPendingApproval('appr_unk', 'sess_unk', 'thread_unk', 'call_unk', '/unknown.txt');
    await approvals.approveTool({ id: 904, send: vi.fn() }, 'appr_unk', true, 'user approved');
    // Simulate the crash window: a previous attempt marked the effect as
    // started and died before recording the result.
    const binding = (getSessionEvents('thread_unk')[0].payload as { binding: unknown }).binding;
    appendSessionEvents('thread_unk', getSessionEventRevision('thread_unk'), [
      {
        type: TOOL_EXECUTION_STARTED,
        version: 1,
        payload: { binding },
      },
    ]);
    server.setScript('probe-appr_unk', {
      chunks: [sse.delta('effect result unknown, not retried'), sse.finish('stop')],
    });

    const outcome = await candidateResume('appr_unk');
    expect(outcome.kind).toBe('unknown');
    expect(server.countRequests('probe-appr_unk')).toBe(0);
    expect(executions).toEqual([]);
  });
});

// A completed legacy fixture exercises import into the new action owner;
// it does not claim to traverse the full old harness continuation.
it('legacy completed result must prevent a second effect when the new action stream has no record', async () => {
  executions.length = 0;
  registerPendingApproval(
    'appr_legacy_done',
    'sess_legacy_done',
    'thread_legacy_done',
    'call_legacy_done',
    '/legacy-done.txt'
  );
  await approvals.approveTool({ id: 907, send: vi.fn() }, 'appr_legacy_done', true, 'approved');
  const oldResult = await readFileTool.handler({ path: '/legacy-done.txt' });
  getDb()
    .prepare(
      "UPDATE tool_call_approvals SET state = 'consumed' WHERE approval_id = 'appr_legacy_done'"
    )
    .run();
  conversation.createMessage({
    id: 'msg_appr_legacy_done',
    thread_id: 'thread_legacy_done',
    message: JSON.stringify({
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'read_file',
          toolCallId: 'call_legacy_done',
          state: 'output-available',
          input: { path: '/legacy-done.txt' },
          output: oldResult,
        },
      ],
    }),
    timestamp: new Date().toISOString(),
    metadata: '{}',
  });
  expect(getToolCallApproval('appr_legacy_done')).toMatchObject({
    state: 'consumed',
    decision: 'approved',
  });
  expect(getSessionEvents('thread_legacy_done', [TOOL_EXECUTION_STARTED])).toEqual([]);
  const { getChatMessages } = await import('@iki/backend/db/chat_message');
  expect(JSON.stringify(getChatMessages('thread_legacy_done'))).toContain(
    'contents of /legacy-done.txt'
  );
  expect(executions).toEqual(['read_file:/legacy-done.txt']);
  server.setScript('probe-appr_legacy_done', { chunks: [sse.delta('done'), sse.finish('stop')] });
  await candidateResume('appr_legacy_done');
  expect(
    executions,
    'legacy completed effects must not run again just because the new action stream has no record'
  ).toEqual(['read_file:/legacy-done.txt']);
});
