// @vitest-environment node

/**
 * The chunk reducer is what turns a turn's chunk log into the persisted
 * assistant message. It replaced the AI SDK's `readUIMessageStream` (ADR 009),
 * so these cases pin the behaviours the persisted row depends on.
 */
import { describe, expect, it } from 'vitest';

import {
  reduceChunkLogToMessage,
  reduceChunkLogToMessages,
} from '../../../packages/backend/src/message/ui_chunk_reducer';
import type { ChatUiChunk } from '../../../packages/backend/src/message/ui_protocol';

const mid = 'assistant_1';

describe('reduceChunkLogToMessages', () => {
  it('folds text deltas into one text part', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'text-delta', messageId: mid, delta: 'Hello' },
      { type: 'text-delta', messageId: mid, delta: ', ' },
      { type: 'text-delta', messageId: mid, delta: 'world' },
      { type: 'text-end', messageId: mid },
      { type: 'finish', messageId: mid },
    ];

    const message = reduceChunkLogToMessage(chunks);
    expect(message?.parts).toEqual([{ type: 'text', text: 'Hello, world', state: 'done' }]);
  });

  it('keeps reasoning separate from the answer', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'reasoning-delta', messageId: mid, delta: 'thinking…' },
      { type: 'reasoning-end', messageId: mid },
      { type: 'text-delta', messageId: mid, delta: 'answer' },
      { type: 'text-end', messageId: mid },
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: 'reasoning', text: 'thinking…', state: 'done' });
    expect(parts[1]).toMatchObject({ type: 'text', text: 'answer', state: 'done' });
  });

  it('joins a tool result onto the call it answers instead of adding an entry', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      {
        type: 'tool-input-start',
        toolCallId: 'call_1',
        toolName: 'read_file',
        dynamic: true,
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read_file',
        input: { path: '/a.txt' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call_1',
        output: 'contents',
      },
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolCallId: 'call_1',
      toolName: 'read_file',
      state: 'output-available',
      input: { path: '/a.txt' },
      output: 'contents',
    });
  });

  it('records a tool result whose call chunk was lost', () => {
    // Dropping it would hide an effect that really executed.
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      {
        type: 'tool-input-start',
        toolCallId: 'call_orphan',
        toolName: 'write_file',
        dynamic: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call_orphan',
        output: 'ok',
      },
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ toolCallId: 'call_orphan', state: 'output-available' });
  });

  it('marks an unclosed streaming part done so the renderer stops waiting', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'text-delta', messageId: mid, delta: 'partial answer' },
      // no text-end / finish: the turn was aborted
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    expect(parts[0]).toMatchObject({ type: 'text', text: 'partial answer', state: 'done' });
  });

  it('keeps appending after an end chunk (an interrupted stream can resume)', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'text-delta', messageId: mid, delta: 'first' },
      { type: 'text-end', messageId: mid },
      { type: 'text-delta', messageId: mid, delta: 'second' },
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    // Two text parts: the closed one and the resumed one, both preserved.
    expect(parts.map(part => (part as { text?: string }).text)).toEqual(['first', 'second']);
  });

  it('prepends a seeded part list (approval-pause resume)', () => {
    const seed = {
      messageId: mid,
      parts: [
        { type: 'text', text: 'before the pause', state: 'done' },
      ] as never,
    };
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'text-delta', messageId: mid, delta: 'after resuming' },
      { type: 'text-end', messageId: mid },
    ];

    const parts = reduceChunkLogToMessage(chunks, { seed })?.parts ?? [];
    expect(parts.map(part => (part as { text?: string }).text)).toEqual([
      'before the pause',
      'after resuming',
    ]);
  });

  it('gives each message id its own message (handoff chains emit a new one)', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: 'a' },
      { type: 'text-delta', messageId: 'a', delta: 'first segment' },
      { type: 'finish', messageId: 'a' },
      { type: 'start', messageId: 'b' },
      { type: 'text-delta', messageId: 'b', delta: 'chained segment' },
    ];

    const messages = reduceChunkLogToMessages(chunks);
    expect(messages.map(message => message.id)).toEqual(['a', 'b']);
    expect(messages[1]?.parts[0]).toMatchObject({ text: 'chained segment' });
  });

  it('carries iKi data parts through', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'data-token-usage', id: 'token-usage', data: { inputTokens: 10 } },
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    expect(parts[0]).toEqual({ type: 'data-token-usage', data: { inputTokens: 10 } });
  });

  it('surfaces an error chunk as text the user can read', () => {
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: mid },
      { type: 'error', messageId: mid, errorText: 'provider exploded' },
    ];

    const parts = reduceChunkLogToMessage(chunks)?.parts ?? [];
    expect(parts[0]).toMatchObject({ type: 'text', text: 'provider exploded' });
  });

  it('returns null for an empty log', () => {
    expect(reduceChunkLogToMessage([])).toBeNull();
    expect(reduceChunkLogToMessages([])).toEqual([]);
  });
});
