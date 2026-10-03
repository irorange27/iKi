// @vitest-environment node

/**
 * Flip-precondition 2 (issue #101): the five approval states driven through
 * the REAL approval owner — real ensurePendingApprovalSession registration,
 * real approveTool decision entry, real consume — with the candidate as the
 * SOLE effect executor (at flip the candidate replaces the harness resume,
 * which here declines for lack of a recovery context AFTER the durable
 * decision and consume; no dual execution by construction).
 *
 * The crash window is handled by a candidate-owned execution journal over
 * real SQLite: journal-start (intent) → atomic claim (effect-start) →
 * effect → result. A journal row with an effect-start but no result means
 * a previous attempt died mid-effect OR another attempt holds the claim —
 * the candidate refuses blind replay and reports an unknown result to the
 * model (D7–D9: unknown side effects are never re-executed on assumption).
 *
 * Right-to-act v2: authorization = approved durable decision + an atomic
 * conditional-UPDATE claim on the journal. The owner's consume is not
 * consulted, so the registration shape (with or without recoveryContext,
 * owner-consumed or not) does not change the protocol — the flip-time
 * ordering divergence is resolved by construction.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import {
  getToolCallApproval,
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} from '@iki/backend/db/tool_call_approval';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createTool } from '@iki/backend/tools';
import { z } from 'zod';

import { callModel, createScriptedModel } from '../pi_candidate/helpers/candidate';
import { createScriptedPiServer, sse, type ScriptedPiServer } from '../pi_candidate/helpers/scripted_pi_server';

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

// ── candidate-owned execution journal (real SQLite) ─────────────────────────
const ensureJournalTable = () => {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS candidate_executions (
      approval_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      effect_started_at TEXT,
      result TEXT
    );
  `);
};
const journalStart = (approvalId: string) => {
  getDb()
    .prepare('INSERT OR IGNORE INTO candidate_executions (approval_id, started_at) VALUES (?, ?)')
    .run(approvalId, new Date().toISOString());
};
const journalMarkEffectStarted = (approvalId: string) => {
  getDb()
    .prepare('UPDATE candidate_executions SET effect_started_at = ? WHERE approval_id = ?')
    .run(new Date().toISOString(), approvalId);
};
const journalComplete = (approvalId: string, result: string) => {
  getDb()
    .prepare('UPDATE candidate_executions SET result = ? WHERE approval_id = ?')
    .run(result, approvalId);
};
const journalGet = (approvalId: string) =>
  getDb()
    .prepare('SELECT started_at, effect_started_at, result FROM candidate_executions WHERE approval_id = ?')
    .get(approvalId) as { started_at: string; effect_started_at: string | null; result: string | null } | undefined;

// ── the candidate resume executor ───────────────────────────────────────────
type ResumeOutcome =
  | { kind: 'refused'; reason: string }
  | { kind: 'executed'; effect: string; toolResultText: string; wireText: string }
  | { kind: 'unknown-result'; wireText: string }
  | { kind: 'rejected'; wireText: string };

const candidateResume = async (approvalId: string): Promise<ResumeOutcome> => {
  const approval = getToolCallApproval(approvalId);
  if (!approval) return { kind: 'refused', reason: 'no such approval' };
  if (approval.state === 'pending') {
    return { kind: 'refused', reason: 'decision pending' };
  }
  if (approval.decision !== 'approved') {
    // rejected: no effect ever; the model sees an explicit error result.
    const { final } = await callModel(model, {
      systemPrompt: 'candidate',
      messages: [
        { role: 'user', content: `probe-${approvalId}`, timestamp: Date.now() },
        {
          role: 'toolResult',
          toolCallId: approval.tool_call_id ?? 'call',
          toolName: approval.tool_name ?? 'tool',
          content: [{ type: 'text', text: approval.decision_reason ?? 'denied' }],
          isError: true,
          timestamp: Date.now(),
        },
      ],
    });
    return { kind: 'rejected', wireText: JSON.stringify(final.content) };
  }

  journalStart(approvalId);

  // Right-to-act v2: authorization = approved durable decision + an ATOMIC
  // claim on the journal. The owner's consume is not consulted, so a
  // flip-time owner-consumed row reads as authorized exactly like an
  // answered one. The conditional UPDATE is the concurrency guard: exactly
  // one contender flips effect_started_at.
  const claim = getDb()
    .prepare(
      'UPDATE candidate_executions SET effect_started_at = ? WHERE approval_id = ? AND effect_started_at IS NULL AND result IS NULL'
    )
    .run(new Date().toISOString(), approvalId);
  if (claim.changes === 0) {
    const entry = journalGet(approvalId)!;
    if (entry.result !== null) {
      return { kind: 'refused', reason: 'already executed (journal has result)' };
    }
    // Claimed by another attempt (concurrent) or by an attempt that died
    // before recording the result (crash window): the side-effect state is
    // IN-FLIGHT-OR-UNKNOWN — never blind-replay, never assume failure.
    const { final } = await callModel(model, {
      systemPrompt: 'candidate',
      messages: [
        { role: 'user', content: `probe-${approvalId}`, timestamp: Date.now() },
        {
          role: 'toolResult',
          toolCallId: approval.tool_call_id ?? 'call',
          toolName: approval.tool_name ?? 'tool',
          content: [
            { type: 'text', text: 'execution in flight or interrupted; result unknown' },
          ],
          isError: true,
          timestamp: Date.now(),
        },
      ],
    });
    return { kind: 'unknown-result', wireText: JSON.stringify(final.content) };
  }

  const args = JSON.parse(approval.tool_args ?? '{}') as { path: string };
  const output = await readFileTool.handler(args);
  journalComplete(approvalId, 'ok');

  const toolResultText = JSON.stringify(output);
  const { final } = await callModel(model, {
    systemPrompt: 'candidate',
    messages: [
      { role: 'user', content: `probe-${approvalId}`, timestamp: Date.now() },
      {
        role: 'toolResult',
        toolCallId: approval.tool_call_id ?? 'call',
        toolName: approval.tool_name ?? 'tool',
        content: [{ type: 'text', text: toolResultText }],
        isError: false,
        timestamp: Date.now(),
      },
    ],
  });
  return { kind: 'executed', effect: executedEffects0(), toolResultText, wireText: JSON.stringify(final.content) };
};
const executedEffects0 = () => executions.join(',');

// ── real owner registration helper ──────────────────────────────────────────
let approvals: ReturnType<typeof createChatApproval>;
let conversation: ReturnType<typeof createChatPersistence>;
const registerPendingApproval = (id: string, sessionId: string, threadId: string, callId: string, argsPath: string) => {
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
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-approval-'));
  initializeDatabase({ dbPath: path.join(root, 'approval-resume.db') });
  ensureJournalTable();
  server = await createScriptedPiServer();
  model.baseUrl = `http://127.0.0.1:${server.port}/v1`;

  const coordinator = createThreadStreamCoordinator();
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
    journalStart('appr_ok');

    // The REAL decision entry. Its resume continuation declines (no recovery
    // context — the harness is not registered in this bounded experiment),
    // but the durable decision and the session consume have landed first.
    await approvals.approveTool({ id: 901, send: vi.fn() }, 'appr_ok', true, 'user approved');
    expect(getToolCallApproval('appr_ok')).toMatchObject({ state: 'answered', decision: 'approved' });

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
    expect(outcome).toEqual({ kind: 'refused', reason: 'already executed (journal has result)' });
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
    const wireToolResult = (wire.messages as Array<{ role: string; content?: string | Array<{ text?: string }> }>)
      .find(m => m.role === 'tool');
    const denialText =
      typeof wireToolResult?.content === 'string'
        ? wireToolResult.content
        : (wireToolResult?.content?.[0]?.text ?? '');
    expect(denialText).toContain('user denied');
    expect(executions).toEqual([]);
  });

  it('duplicate decision after completion: post-completion decline, no new effect', async () => {
    executions.length = 0;
    const again = await approvals.approveTool({ id: 903, send: vi.fn() }, 'appr_ok', true, 'user approved');
    // The owner's idempotent branch exists only while the batch session is
    // registered; after completion a re-approve declines — the durable
    // decision is untouched and no effect runs.
    expect(again.success).toBe(false);
    // v2: the consume token is gone from the protocol — the durable decision
    // stays 'answered' and the journal carries the execution record.
    expect(getToolCallApproval('appr_ok')).toMatchObject({ state: 'answered', decision: 'approved' });
    expect(journalGet('appr_ok')).toMatchObject({ result: 'ok' });
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
    expect(getToolCallApproval('appr_oc')).toMatchObject({ state: 'consumed', decision: 'approved' });
    expect(journalGet('appr_oc')).toBeUndefined();

    const outcome = await candidateResume('appr_oc');
    expect(outcome.kind).toBe('executed');
    expect(executions).toEqual(['read_file:/owner-consumed.txt']);
  });

  it('concurrent resumes: the atomic claim lets exactly one execute', async () => {
    executions.length = 0;
    registerPendingApproval('appr_conc', 'sess_conc', 'thread_conc', 'call_conc', '/concurrent.txt');
    await approvals.approveTool({ id: 905, send: vi.fn() }, 'appr_conc', true, 'user approved');

    const [a, b] = await Promise.all([candidateResume('appr_conc'), candidateResume('appr_conc')]);
    const kinds = [a.kind, b.kind].sort();
    // The winner executes; the loser sees the claim held — in-flight-or-
    // unknown, never a second effect.
    expect(kinds).toEqual(['executed', 'unknown-result']);
    expect(executions).toEqual(['read_file:/concurrent.txt']);
  });

  it('unknown: a journal entry with effect-start but no result refuses blind replay', async () => {
    executions.length = 0;
    registerPendingApproval('appr_unk', 'sess_unk', 'thread_unk', 'call_unk', '/unknown.txt');
    await approvals.approveTool({ id: 904, send: vi.fn() }, 'appr_unk', true, 'user approved');
    journalStart('appr_unk');
    // Simulate the crash window: a previous attempt marked the effect as
    // started and died before recording the result.
    journalMarkEffectStarted('appr_unk');
    server.setScript('probe-appr_unk', {
      chunks: [sse.delta('effect result unknown, not retried'), sse.finish('stop')],
    });

    const outcome = await candidateResume('appr_unk');
    expect(outcome.kind).toBe('unknown-result');
    if (outcome.kind !== 'unknown-result') return;
    expect(outcome.wireText).toContain('unknown');
    expect(executions).toEqual([]);
  });
});
