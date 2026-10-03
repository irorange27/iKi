/**
 * E1 bounded candidate integration (issue #96): the Pi-AI supply layer must
 * carry iKi's REAL contract surfaces — real BaseTool zod validation, the real
 * tool_call_approval state machine, the real session_events commit gate, and
 * history written by the current persistence code. Test-only; production is
 * untouched. Evidence standard per the migration review: server-side request
 * counting, wire capture, and durable state instead of in-memory doubles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addChatMessage, getChatMessages } from '@iki/backend/db/chat_message';
import {
  answerToolCallApproval,
  consumeToolCallApprovalSession,
  getToolCallApproval,
  getToolCallApprovalsBySession,
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} from '@iki/backend/db/tool_call_approval';
import { appendSessionEvents, getSessionEvents } from '@iki/backend/db/session_events';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  MODEL_TEXT_COMMITTED,
  SESSION_EVENT_VERSION,
  TURN_COMPLETED,
  recordSessionEvents,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import {
  parseStoredUiMessageRow,
  sanitizeUiMessageJsonForStorage,
} from '@iki/backend/message/ui_message_codec';
import { createTool } from '@iki/backend/tools';
import { z } from 'zod';

import {
  BudgetExceededError,
  callModel,
  createScriptedModel,
  firstToolCall,
  runBoundedCall,
  textOf,
} from './helpers/candidate';
import { createScriptedPiServer, sse, type ScriptedPiServer } from './helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
const executedEffects: string[] = [];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-candidate-'));
  initializeDatabase({ dbPath: path.join(root, 'candidate.db') });
  server = await createScriptedPiServer();
});

afterAll(async () => {
  await server.close();
  closeDatabase();
});

// The candidate's tool: the REAL BaseTool pipeline — zod paramSchema for
// execution validation, `.parameters` (zod→JSON Schema) as the wire projection.
const readFileTool = createTool({
  name: 'read_file',
  type: 'fs',
  description: 'Read a file from the workspace',
  paramSchema: z.object({
    path: z.string().describe('Absolute path inside the workspace'),
  }),
  handler: async args => {
    executedEffects.push(`read_file:${args.path}`);
    return { content: `contents of ${args.path}` };
  },
});
const candidateTools = [
  { name: readFileTool.name, description: readFileTool.description, parameters: readFileTool.parameters },
];

const userTurn = (text: string, ts: number) => ({ role: 'user' as const, content: text, timestamp: ts });

describe('Pi candidate integration — real iKi contract surfaces', () => {
  it('scenario A: the second wire request carries the complete prior exchange, with server-side request counting', async () => {
    executedEffects.length = 0;
    const model = createScriptedModel(server.port);
    // Same wire key for BOTH requests — the fixed context snapshot. The
    // script is swapped between calls; captures stay ordered per key.
    server.setScript('read the file', {
      chunks: [
        sse.toolCallDelta('call_1', 'read_file', '{"path":'),
        sse.toolCallDelta(null, null, '"\u002ftmp\u002fiki-candidate.txt"}'),
        sse.finish('tool_calls'),
      ],
    });

    const budget = { used: 0, max: 3 };
    const snapshot = [userTurn('read the file', Date.now())];
    const turn1 = await runBoundedCall(
      model,
      { systemPrompt: 'candidate', messages: snapshot, tools: candidateTools },
      budget
    );
    expect(budget.used).toBe(1);
    expect(server.countRequests('read the file')).toBe(1);
    const toolCall = firstToolCall(turn1.final);
    expect(toolCall).toMatchObject({ name: 'read_file' });

    // Real BaseTool execution: zod validates, handler records the effect.
    const output = await readFileTool.handler(toolCall!.arguments);
    expect(executedEffects).toEqual(['read_file:/tmp/iki-candidate.txt']);

    // Swap the script for the resume call — same key, second capture.
    server.setScript('read the file', {
      chunks: [sse.delta('the file says hi'), sse.finish('stop')],
    });
    const turn2 = await runBoundedCall(
      model,
      {
        systemPrompt: 'candidate',
        messages: [
          ...snapshot,
          turn1.final,
          {
            role: 'toolResult',
            toolCallId: toolCall!.id,
            toolName: 'read_file',
            content: [{ type: 'text', text: JSON.stringify(output) }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
        tools: candidateTools,
      },
      budget
    );

    // Budget and HTTP counts agree — no hidden extra requests.
    expect(budget.used).toBe(2);
    expect(server.countRequests('read the file')).toBe(2);
    expect(textOf(turn2.final)).toBe('the file says hi');

    // Request 2's wire: complete prior exchange + the real schema projection.
    const wire2 = server.getWire('read the file', 1);
    const roles = (wire2.messages as Array<{ role: string }>).map(m => m.role);
    // Pi folds the caller's systemPrompt into a leading system message.
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool']);
    const serialized = JSON.stringify(wire2);
    expect(serialized).toContain('/tmp/iki-candidate.txt');
    expect(serialized).toContain('contents of');
    const wireTools = wire2.tools as Array<{ function: { parameters: unknown } }>;
    expect(wireTools[0].function.parameters).toEqual(readFileTool.parameters);
  });

  it('scenario B: approval decisions are durable — resume executes the effect exactly once via the real state machine', async () => {
    executedEffects.length = 0;
    const model = createScriptedModel(server.port);
    server.setScript('secret please', {
      chunks: [
        sse.toolCallDelta('call_sec', 'read_file', '{"path":"\u002ftmp\u002fsecret.txt"}'),
        sse.finish('tool_calls'),
      ],
    });
    server.setScript('secret resumed', {
      chunks: [sse.delta('done, secret read'), sse.finish('stop')],
    });
    server.setScript('secret denied', {
      chunks: [sse.delta('understood, not reading'), sse.finish('stop')],
    });

    // Real approval session + pending approval row, as the real owner writes them.
    addChatThread({
      id: 'thread_pi_b',
      title: 'approval thread',
      metadata: '{}',
      is_generating: false,
      is_favorited: 0,
      is_incognito: 0,
      enable_artifacts: 0,
    });
    upsertToolCallApprovalSession({
      session_id: 'sess_pi_1',
      thread_id: 'thread_pi_b',
      assistant_message_id: 'msg_b_1',
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
        approval_id: 'appr_pi_1',
        session_id: 'sess_pi_1',
        tool_call_id: 'call_sec',
        tool_name: 'read_file',
        tool_args: JSON.stringify({ path: '/tmp/secret.txt' }),
        state: 'pending',
      },
    ]);

    const budget = { used: 0, max: 5 };
    const turn1 = await runBoundedCall(
      model,
      {
        systemPrompt: 'candidate',
        messages: [userTurn('secret please', Date.now())],
        tools: candidateTools,
      },
      budget
    );
    const toolCall = firstToolCall(turn1.final)!;

    // Before any decision: a resume invocation must NOT execute. The durable
    // row is the authority — no in-memory set involved.
    const pendingRows = getToolCallApprovalsBySession('sess_pi_1');
    expect(pendingRows.map(r => r.state)).toEqual(['pending']);
    expect(executedEffects).toEqual([]);

    // The real owner's decision write.
    answerToolCallApproval('appr_pi_1', 'approved', 'user approved');

    // Resume invocation (a fresh call in this test stands in for the
    // post-restart resume): execute under the session consume guard.
    const guardOnce = consumeToolCallApprovalSession('sess_pi_1');
    expect(guardOnce.changes).toBe(1);
    const args = JSON.parse(getToolCallApproval('appr_pi_1')!.tool_args!);
    await readFileTool.handler(args);
    expect(executedEffects).toEqual(['read_file:/tmp/secret.txt']);

    const resumed = await callModel(model, {
      systemPrompt: 'candidate',
      messages: [
        userTurn('secret resumed', Date.now()),
        turn1.final,
        {
          role: 'toolResult',
          toolCallId: 'call_sec',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'read' }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    });
    expect(textOf(resumed.final)).toBe('done, secret read');

    // A duplicate resume hits the same guard: consume reports 0 changes and
    // the effect must not re-run.
    const guardDuplicate = consumeToolCallApprovalSession('sess_pi_1');
    expect(guardDuplicate.changes).toBe(0);
    expect(executedEffects).toEqual(['read_file:/tmp/secret.txt']);
    expect(getToolCallApproval('appr_pi_1')).toMatchObject({ state: 'consumed', decision: 'approved' });

    // Denied path: decision rejected → no execution, loop continues with an
    // error result for the model.
    upsertToolCallApprovals([
      {
        approval_id: 'appr_pi_2',
        session_id: 'sess_pi_1',
        tool_call_id: 'call_sec_2',
        tool_name: 'read_file',
        tool_args: JSON.stringify({ path: '/tmp/other.txt' }),
        state: 'pending',
      },
    ]);
    answerToolCallApproval('appr_pi_2', 'rejected', 'user denied');
    // The consume guard is batch-level: a freshly answered batch is
    // consumable again. What governs the ACTION is the durable decision —
    // 'rejected' means the candidate never executes.
    const deniedGuard = consumeToolCallApprovalSession('sess_pi_1');
    expect(deniedGuard.changes).toBe(1);
    expect(getToolCallApproval('appr_pi_2')).toMatchObject({ state: 'consumed', decision: 'rejected' });
    expect(executedEffects).toEqual(['read_file:/tmp/secret.txt']);
    const denied = await callModel(model, {
      systemPrompt: 'candidate',
      messages: [
        userTurn('secret denied', Date.now()),
        {
          role: 'toolResult',
          toolCallId: 'call_sec_2',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'user denied the tool call' }],
          isError: true,
          timestamp: Date.now(),
        },
      ],
    });
    expect(textOf(denied.final)).toBe('understood, not reading');
  });

  it('scenario C: the commit gate on real session_events — publish failure cannot unseat shown ⊆ committed', async () => {
    const threadId = 'thread_pi_c';
    const runId = 'run_c_1';
    const messageId = 'msg_c_1';
    recordSessionEvents(threadId, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'msg_c_in',
          message: { id: 'msg_c_in', role: 'user', parts: [{ type: 'text', text: 'tell me a story' }] },
        },
      },
    ]);

    // The candidate buffers deltas; a flush commits to the stream FIRST and
    // only then publishes. The target fails on the second publish.
    const buffered: string[] = [];
    const committed: string[] = [];
    const published: string[] = [];
    let seq = 0;
    // The target owns the published record and dies after the first chunk.
    const failingTarget = {
      push: (chunk: string) => {
        if (published.length >= 1) throw new Error('renderer gone');
        published.push(chunk);
      },
    };
    const flushAndPublish = (text: string) => {
      buffered.push(text);
      // Commit FIRST: the stream fact lands before any publish attempt.
      recordSessionEvents(threadId, [
        { type: MODEL_TEXT_COMMITTED, version: SESSION_EVENT_VERSION, payload: { runId, messageId, seq: seq++, text } },
      ]);
      committed.push(text);
      failingTarget.push(text);
    };

    flushAndPublish('chapter one. ');
    expect(() => flushAndPublish('chapter two.')).toThrow('renderer gone');

    // The commit for "chapter two." already landed: recordSessionEvents ran
    // before the throwing publish. Record the output + terminal facts.
    const committedText = buffered.join('');
    recordSessionEvents(threadId, [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId,
          messageId,
          message: { id: messageId, role: 'assistant', parts: [{ type: 'text', text: committedText }] },
          transport: 'pi-candidate',
        },
      },
      { type: TURN_COMPLETED, version: SESSION_EVENT_VERSION, payload: { runId, status: 'completed' } },
    ]);

    // Shown ⊆ committed despite the publish failure.
    expect(committedText).toBe('chapter one. chapter two.');
    expect(published.join('')).toBe('chapter one. ');
    expect(committedText.startsWith(published.join(''))).toBe(true);

    // Replay rebuilds the full view from the stream alone — twice, pure.
    const view1 = rebuildThreadViewFromEvents(threadId);
    const view2 = rebuildThreadViewFromEvents(threadId);
    expect(view1).toEqual(view2);
    const assistant = view1.messages.find(m => m.id === messageId);
    expect(assistant).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'chapter one. chapter two.' }],
    });

    // Revision discipline: a writer basing on a stale head writes nothing.
    const stale = appendSessionEvents(threadId, 0, [
      { type: MODEL_TEXT_COMMITTED, version: SESSION_EVENT_VERSION, payload: { runId, messageId, seq: 99, text: 'stale' } },
    ]);
    expect(stale).toBeNull();
    expect(getSessionEvents(threadId).some(e => JSON.stringify(e.payload).includes('stale'))).toBe(false);
  });

  it('scenario D: history written by the current persistence code is readable through the candidate path', async () => {
    const model = createScriptedModel(server.port);
    const threadId = 'thread_pi_d';
    addChatThread({
      id: threadId,
      title: 'old data',
      metadata: '{}',
      is_generating: false,
      is_favorited: 0,
      is_incognito: 0,
      enable_artifacts: 0,
    });
    // Write rows exactly the way createChatPersistence does: sanitized UI JSON.
    addChatMessage({
      id: 'msg_d_u',
      thread_id: threadId,
      message: sanitizeUiMessageJsonForStorage(
        JSON.stringify({ role: 'user', parts: [{ type: 'text', text: 'old question' }] })
      ),
      timestamp: new Date().toISOString(),
      metadata: '{}',
    });
    addChatMessage({
      id: 'msg_d_a',
      thread_id: threadId,
      message: sanitizeUiMessageJsonForStorage(
        JSON.stringify({ role: 'assistant', parts: [{ type: 'text', text: 'old answer' }] })
      ),
      timestamp: new Date().toISOString(),
      metadata: '{}',
    });

    const rows = getChatMessages(threadId);
    // The real read path: DB rows → stored UI message parse → model messages.
    const uiMessages = rows
      .map(row => parseStoredUiMessageRow({ id: row.id, message: row.message }))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const history = await toModelInputMessages(uiMessages);
    expect(history.length).toBe(2);

    // Project the persisted history into VALID Pi messages. The projection
    // layer must satisfy Pi's message contract (assistant messages carry
    // api/provider/model/usage/stopReason) — a thinner shape gets dropped by
    // the supply adapter's transcript transform (observed, see review F4).
    server.setScript('follow-up', {
      chunks: [sse.delta('fresh answer'), sse.finish('stop')],
    });
    const zeroUsage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const textFromContent = (content: unknown): string => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map(part => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
          .join('');
      }
      return '';
    };
    const projectMessage = (message: unknown): Record<string, unknown> => {
      const m = message as { role: string; content: unknown };
      const text = textFromContent(m.content);
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: [{ type: 'text', text }],
          api: 'openai-completions',
          provider: 'scripted',
          model: 'scripted-model',
          usage: zeroUsage,
          stopReason: 'stop',
          timestamp: Date.now(),
        };
      }
      return { role: m.role, content: text, timestamp: Date.now() };
    };
    const { final } = await callModel(model, {
      systemPrompt: 'candidate',
      messages: [...history.map(projectMessage), userTurn('follow-up', Date.now())],
    });
    expect(textOf(final)).toBe('fresh answer');

    const wire = server.getWire('follow-up');
    const serialized = JSON.stringify(wire.messages);
    expect(serialized).toContain('old question');
    expect(serialized).toContain('old answer');
  });

  it('scenario A regression: the candidate loop enforces its own request budget', async () => {
    const model = createScriptedModel(server.port);
    server.setScript('budget probe', { chunks: [sse.delta('x'), sse.finish('stop')] });
    const budget = { used: 0, max: 1 };
    await runBoundedCall(
      model,
      { systemPrompt: 'candidate', messages: [userTurn('budget probe', Date.now())] },
      budget
    );
    await expect(
      runBoundedCall(
        model,
        { systemPrompt: 'candidate', messages: [userTurn('budget probe', Date.now())] },
        budget
      )
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(server.countRequests('budget probe')).toBe(1);
  });
});
