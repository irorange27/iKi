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
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';
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
    // The synthesized envelope must be complete — missing fields get the
    // message dropped by Pi's transcript transform (E1 scenario D finding).
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
