import { describe, expect, it } from 'vitest';

import {
  extractTextFromModelMessageContent,
  hasToolPartInModelMessageContent,
  sanitizeModelConversationMessages,
} from '../../../src/core/agent/model_messages';

describe('extractTextFromModelMessageContent', () => {
  it('concatenates text parts and ignores non-text parts', () => {
    expect(
      extractTextFromModelMessageContent([
        { type: 'text', text: 'hello ' },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: {} },
        { type: 'text', text: 'world' },
      ])
    ).toBe('hello world');
  });

  it('detects tool-bearing assistant content', () => {
    expect(
      hasToolPartInModelMessageContent([
        { type: 'text', text: 'Searching...' },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: {} },
      ])
    ).toBe(true);
    expect(hasToolPartInModelMessageContent([{ type: 'text', text: 'hello world' }])).toBe(false);
  });

  it('drops orphaned tool messages while preserving anchored tool runs', () => {
    const sanitized = sanitizeModelConversationMessages([
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'orphan_1', output: { ok: false } }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: {} }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_1', output: { ok: true } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_2', output: { ok: true } }],
      },
      {
        role: 'user',
        content: 'summarize that',
      },
    ]);

    expect(sanitized).toEqual({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: {} }],
        },
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'call_1', output: { ok: true } }],
        },
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'call_2', output: { ok: true } }],
        },
        {
          role: 'user',
          content: 'summarize that',
        },
      ],
      droppedMessages: 1,
    });
  });
});
