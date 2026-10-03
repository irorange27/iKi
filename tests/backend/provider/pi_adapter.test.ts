/**
 * Pi supply adapter tests (issue #98): projection shapes, the usage mapping,
 * the no-strict tool rule, and the wire-level supply-transform behaviors the
 * adapter layer must EXPECT (review F4) — driven through the same scripted
 * SSE server the E1 candidate used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addChatMessage, getChatMessages } from '@iki/backend/db/chat_message';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { persistAssistantTurnMessage } from '@iki/backend/thread_session/turn_persistence';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import {
  parseStoredUiMessageRow,
  sanitizeUiMessageJsonForStorage,
} from '@iki/backend/message/ui_message_codec';
import {
  PiProjectionError,
  buildPiModel,
  callPiChat,
  projectHistoryToPiContext,
  projectToolsToPiTools,
  projectUsageToIki,
} from '@iki/backend/provider/llm/pi_adapter';
import { createScriptedPiServer, sse, type ScriptedPiServer } from '../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
const model = buildPiModel({
  id: 'scripted-model',
  baseUrl: '', // filled after the server binds
  contextWindow: 100000,
  maxTokens: 2000,
});

const collectFinal = async (context: Parameters<typeof callPiChat>[1]) => {
  const eventStream = callPiChat(model, context, { apiKey: 'test-key' });
  const resultPromise = eventStream.result();
  for await (const _event of eventStream) {
    void _event;
  }
  return resultPromise;
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-adapter-'));
  initializeDatabase({ dbPath: path.join(root, 'adapter.db') });
  server = await createScriptedPiServer();
  model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
});

afterAll(async () => {
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('Pi supply adapter — projection', () => {
  it('projects the full history shape: leading system → prompt, tool calls and results kept, envelope synthesized', () => {
    const history = [
      { role: 'system', content: 'base prompt' },
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: '/a.txt' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'read_file', output: { type: 'text', value: 'file body' } }],
      },
      { role: 'system', content: 'additional instruction' },
      { role: 'user', content: 'and now?' },
    ] as unknown as ChatInputMessage[];

    const { systemPrompt, messages } = projectHistoryToPiContext(history, 'scripted-model');
    expect(systemPrompt).toBe('base prompt');

    const roles = messages.map(m => m.role);
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'system', 'user']);

    const assistant = messages[1] as Extract<(typeof messages)[number], { role: 'assistant' }>;
    // The envelope must be a VALID Pi representation (type contract). Note
    // (rereview G6): a missing envelope alone is NOT dropped from the wire —
    // the original E1 failure's root cause was never individually confirmed;
    // the synthesis exists for type validity, not as a drop-guard, and its
    // fields are compatibility assumptions, not recorded facts.
    expect(assistant.api).toBe('openai-completions');
    expect(assistant.provider).toBe('iki-custom');
    expect(assistant.model).toBe('scripted-model');
    expect(assistant.stopReason).toBe('stop');
    expect(assistant.usage.totalTokens).toBe(0);
    const toolCall = assistant.content.find(b => b.type === 'toolCall');
    expect(toolCall).toMatchObject({ id: 'call_1', name: 'read_file', arguments: { path: '/a.txt' } });

    const toolResult = messages[2] as Extract<(typeof messages)[number], { role: 'toolResult' }>;
    expect(toolResult).toMatchObject({ toolCallId: 'call_1', isError: false });
    expect(toolResult.content[0]).toMatchObject({ text: 'file body' });
  });

  it('maps error outputs to isError tool results instead of dropping them', () => {
    const history = [
      { role: 'user', content: 'run it' },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'call_x', toolName: 'shell', output: { type: 'error-text', value: 'boom' } },
        ],
      },
    ] as unknown as ChatInputMessage[];

    const { messages } = projectHistoryToPiContext(history, 'scripted-model');
    const toolResult = messages[1] as Extract<(typeof messages)[number], { role: 'toolResult' }>;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.content[0]).toMatchObject({ text: 'boom' });
  });

  it('throws on unrepresentable parts instead of dropping them silently', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'file', data: 'x', mediaType: 'application/pdf' }] },
    ] as unknown as ChatInputMessage[];

    expect(() => projectHistoryToPiContext(history, 'scripted-model')).toThrow(PiProjectionError);
    expect(() => projectHistoryToPiContext(history, 'scripted-model')).toThrow(/file/);
  });

  it('projects user PART ARRAYS — the shape convertToModelMessages actually emits', () => {
    // The real pipeline wraps user content in a part array even for a single
    // text part; the string form is a test/rehydration convenience only.
    const history = [
      { role: 'user', content: [{ type: 'text', text: 'part-array question' }] },
    ] as unknown as ChatInputMessage[];

    const { messages } = projectHistoryToPiContext(history, 'scripted-model');
    expect(messages[0]).toMatchObject({ role: 'user', content: 'part-array question' });
  });

  it('throws on user part types outside the covered domain (image/file)', () => {
    const history = [
      { role: 'user', content: [{ type: 'image', image: 'data:image/png;base64,x' }] },
    ] as unknown as ChatInputMessage[];

    expect(() => projectHistoryToPiContext(history, 'scripted-model')).toThrow(PiProjectionError);
    expect(() => projectHistoryToPiContext(history, 'scripted-model')).toThrow(/image/);
  });

  it('regression (real pipeline boundary): toModelInputMessages output projects without error', async () => {
    // Drive the ACTUAL pipeline — persisted rows → parse → toModelInputMessages —
    // into the projection. The committed projection tests must never be the
    // only witnesses of their own input shapes (review B1).
    const threadId = 'thread_pi_adapter';
    addChatThread({
      id: threadId,
      title: 'adapter boundary',
      metadata: '{}',
      is_generating: false,
      is_favorited: 0,
      is_incognito: 0,
      enable_artifacts: 0,
    });
    addChatMessage({
      id: 'msg_ab_u',
      thread_id: threadId,
      message: sanitizeUiMessageJsonForStorage(
        JSON.stringify({ role: 'user', parts: [{ type: 'text', text: 'real pipeline question' }] })
      ),
      timestamp: new Date(Date.now() - 1000).toISOString(),
      metadata: '{}',
    });
    addChatMessage({
      id: 'msg_ab_a',
      thread_id: threadId,
      message: sanitizeUiMessageJsonForStorage(
        JSON.stringify({ role: 'assistant', parts: [{ type: 'text', text: 'real pipeline answer' }] })
      ),
      timestamp: new Date().toISOString(),
      metadata: '{}',
    });

    const rows = getChatMessages(threadId);
    const uiMessages = rows
      .map(row => parseStoredUiMessageRow({ id: row.id, message: row.message }))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const history = await toModelInputMessages(uiMessages);
    expect(history.length).toBe(2);

    const { systemPrompt, messages } = projectHistoryToPiContext(history, 'scripted-model');
    expect(systemPrompt).toBe('');
    const roles = messages.map(m => m.role);
    expect(roles).toEqual(['user', 'assistant']);
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('real pipeline question');
    expect(serialized).toContain('real pipeline answer');
    const assistant = messages[1] as Extract<(typeof messages)[number], { role: 'assistant' }>;
    expect(assistant.api).toBe('openai-completions'); // envelope present on real shapes
    expect(assistant.stopReason).toBe('stop');
  });

  it('projects tool-result outputs exhaustively — content text in, media refused (rereview G3)', () => {
    const project = (output: unknown) => {
      const history = [
        { role: 'user', content: 'go' },
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'call_g3', toolName: 'probe', output }],
        },
      ] as unknown as ChatInputMessage[];
      return projectHistoryToPiContext(history, 'scripted-model');
    };

    // content with text parts projects; media inside content REFUSES loudly.
    const textContent = project({
      type: 'content',
      value: [{ type: 'text', text: 'embedded text' }],
    });
    const textResult = textContent.messages[1] as Extract<
      (typeof textContent.messages)[number],
      { role: 'toolResult' }
    >;
    expect(textResult.content[0]).toMatchObject({ text: 'embedded text' });

    expect(() =>
      project({ type: 'content', value: [{ type: 'image-data', data: 'x' }] })
    ).toThrow(/image-data/);

    // json textification stays the documented protocol; error-json → isError.
    const jsonResult = project({ type: 'json', value: { a: 1 } });
    expect(
      (jsonResult.messages[1] as Extract<(typeof jsonResult.messages)[number], { role: 'toolResult' }>)
        .content[0]
    ).toMatchObject({ text: '{"a":1}' });
    const errorResult = project({ type: 'error-json', value: { code: 7 } });
    expect(
      (errorResult.messages[1] as Extract<(typeof errorResult.messages)[number], { role: 'toolResult' }>)
        .isError
    ).toBe(true);

    // execution-denied (approval-deny flow, live history): reason carried as
    // the error text, mirroring the persisted-read path; absent reason falls
    // back to the same default text the reader uses.
    const denied = project({ type: 'execution-denied', reason: 'User rejected tool execution.' });
    const deniedResult = denied.messages[1] as Extract<
      (typeof denied.messages)[number],
      { role: 'toolResult' }
    >;
    expect(deniedResult.isError).toBe(true);
    expect(deniedResult.content[0]).toMatchObject({ text: 'User rejected tool execution.' });
    const deniedNoReason = project({ type: 'execution-denied' });
    expect(
      (deniedNoReason.messages[1] as Extract<(typeof deniedNoReason.messages)[number], { role: 'toolResult' }>)
        .content[0]
    ).toMatchObject({ text: 'Tool call execution denied.' });

    // Unknown output types throw instead of being stringified.
    expect(() => project({ type: 'audio', value: 'x' })).toThrow(/audio/);
  });

  it('projects a cancel-produced partial honestly — text survives, envelope stays a synthesized assumption (rereview G2)', async () => {
    // The REAL producer of interrupted history: the cancel branch persists
    // the partial assistant message with transport 'stream-abort'.
    addChatThread({
      id: 'thread_pi_partial',
      title: 'partial',
      metadata: '{}',
      is_generating: false,
      is_favorited: 0,
      is_incognito: 0,
      enable_artifacts: 0,
    });
    const conversation = createChatPersistence({
      memory: {
        onMessagePersisted: () => undefined,
        onContinuityMessagePersisted: async () => undefined,
      } as never,
    });
    await persistAssistantTurnMessage(
      conversation as never,
      'thread_pi_partial',
      { id: 'msg_partial', role: 'assistant', parts: [{ type: 'text', text: 'INTERRUPTED_PARTIAL' }] },
      'stream-abort'
    );

    // Provenance marker: the real producer records the stream-abort transport
    // — if the producer stopped recording it, the test must fail here.
    const savedRow = getChatMessages('thread_pi_partial').at(-1)!;
    expect(JSON.parse(savedRow.metadata)).toMatchObject({ transport: 'stream-abort' });

    const rows = getChatMessages('thread_pi_partial');
    const uiMessages = rows
      .map(row => parseStoredUiMessageRow({ id: row.id, message: row.message }))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const history = await toModelInputMessages(uiMessages);

    // The partial text IS in history (the old invariant claim was false).
    const { messages } = projectHistoryToPiContext(history, 'scripted-model');
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('INTERRUPTED_PARTIAL');
    // The envelope is synthesized (compatibility assumption, not fact).
    const assistant = messages.find(m => m.role === 'assistant') as { stopReason?: string };
    expect(assistant.stopReason).toBe('stop');
  });

  it('maps Pi usage buckets onto the total-prompt convention', () => {
    const mapped = projectUsageToIki({
      input: 40,
      output: 20,
      cacheRead: 60,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    expect(mapped.inputTokens).toBe(100); // 40 + 60 + 0 — cache restored to the prompt total
    expect(mapped.outputTokens).toBe(20);
    expect(mapped.cacheReadTokens).toBe(60);
    expect(mapped.totalTokens).toBe(120); // Pi already recomputed from buckets
  });

  it('projects tools without strict normalization or regeneration', () => {
    const parameters = {
      type: 'object',
      properties: { path: { type: 'string', description: 'path' }, limit: { type: 'integer' } },
      required: ['path'],
    };
    const tools = projectToolsToPiTools([{ name: 'read_file', description: 'read', parameters }]);
    expect(tools[0].parameters).toBe(parameters); // same object — consumed, not regenerated
    expect(JSON.stringify(tools)).not.toContain('"strict"');
  });
});

describe('Pi supply adapter — wire behaviors over the scripted server', () => {
  it('carries the projected history on the wire: schema pass-through, no strict, envelope survives', async () => {
    server.setScript('adapter wire', {
      chunks: [sse.delta('ok'), sse.finish('stop')],
    });

    const history = [
      { role: 'user', content: 'adapter wire' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_w', toolName: 'read_file', input: { path: '/w.txt' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_w', toolName: 'read_file', output: { type: 'text', value: 'wire body' } }],
      },
    ] as unknown as ChatInputMessage[];
    const { systemPrompt, messages } = projectHistoryToPiContext(history, 'scripted-model');
    const tools = projectToolsToPiTools([
      {
        name: 'read_file',
        description: 'read',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ]);

    const final = await collectFinal({ systemPrompt, messages, tools });
    expect(final.stopReason).toBe('stop');

    const wire = server.getWire('adapter wire');
    const serialized = JSON.stringify(wire);
    expect(serialized).toContain('adapter wire'); // user message survived
    expect(serialized).toContain('/w.txt'); // tool call arguments survived
    expect(serialized).toContain('wire body'); // tool result survived
    expect((wire.tools as Array<{ function: Record<string, unknown> }>)[0].function).not.toHaveProperty('strict');
  });

  it('documents the supply transform (review F4): error-assistant text is withheld and orphan tool calls get synthesized results on the wire', async () => {
    server.setScript('transform probe', {
      chunks: [sse.delta('ack'), sse.finish('stop')],
    });

    // Hand-built Pi messages OUTSIDE the projection (iKi history cannot
    // contain these shapes — the repair path pairs them away). This probe
    // pins what Pi's transform does with them so the adapter layer's
    // expectations are explicit, per review F4.
    const messages = [
      { role: 'user', content: 'transform probe', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'PRESERVED_PARTIAL' }],
        api: 'openai-completions',
        provider: 'iki-custom',
        model: 'scripted-model',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: 'boom',
        timestamp: Date.now(),
      },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call_orphan', name: 'read_file', arguments: { path: '/o.txt' } }],
        api: 'openai-completions',
        provider: 'iki-custom',
        model: 'scripted-model',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    ] as never;

    const final = await collectFinal({ systemPrompt: 'probe', messages });
    expect(final.stopReason).toBe('stop');

    const wire = server.getWire('transform probe');
    const serialized = JSON.stringify(wire.messages);
    expect(serialized).not.toContain('PRESERVED_PARTIAL'); // error-assistant withheld from the wire
    expect(serialized).toContain('No result provided'); // orphan call synthesized an error result
  });
});
