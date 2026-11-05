import { describe, expect, it } from 'vitest';

import {
  extractTextFromModelMessageContent,
  hasToolPartInModelMessageContent,
  sanitizeModelConversationMessages,
} from '@iki/ai/message/model_messages';

const toolCall = (toolCallId: string, toolName = 'web') => ({
  type: 'tool-call',
  toolCallId,
  toolName,
  input: {},
});

const toolResult = (toolCallId: string, ok: boolean) => ({
  type: 'tool-result',
  toolCallId,
  toolName: 'web',
  output: { ok },
});

describe('extractTextFromModelMessageContent', () => {
  it('concatenates text parts and ignores non-text parts', () => {
    expect(
      extractTextFromModelMessageContent([
        { type: 'text', text: 'hello ' },
        toolCall('call_1'),
        { type: 'text', text: 'world' },
      ])
    ).toBe('hello world');
  });

  it('detects tool-bearing assistant content', () => {
    expect(hasToolPartInModelMessageContent([{ type: 'text', text: 'Searching...' }, toolCall('call_1')])).toBe(
      true
    );
    expect(hasToolPartInModelMessageContent([{ type: 'text', text: 'hello world' }])).toBe(false);
  });
});

describe('sanitizeModelConversationMessages: tool pairing by toolCallId', () => {
  it('drops a result whose call is not in the conversation', () => {
    const sanitized = sanitizeModelConversationMessages([
      { role: 'tool', content: [toolResult('orphan_1', false)] },
      { role: 'assistant', content: [toolCall('call_1')] },
      { role: 'tool', content: [toolResult('call_1', true)] },
      { role: 'user', content: 'summarize that' },
    ]);

    expect(sanitized.messages).toEqual([
      { role: 'assistant', content: [toolCall('call_1')] },
      { role: 'tool', content: [toolResult('call_1', true)] },
      { role: 'user', content: 'summarize that' },
    ]);
    expect(sanitized.droppedMessages).toBe(1);
    expect(sanitized.answeredTools).toBe(0);
  });

  it('answers a call that never got a result, so the request stays sendable', () => {
    // A cancelled turn leaves exactly this shape: the assistant asked for a tool
    // and nothing answered it. Providers reject the pair-less call outright.
    const sanitized = sanitizeModelConversationMessages([
      { role: 'user', content: 'run it' },
      { role: 'assistant', content: [toolCall('call_dead', 'web_search')] },
    ]);

    expect(sanitized.messages).toEqual([
      { role: 'user', content: 'run it' },
      { role: 'assistant', content: [toolCall('call_dead', 'web_search')] },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_dead',
            toolName: 'web_search',
            output: { type: 'error-text', value: expect.stringContaining('never answered') },
          },
        ],
      },
    ]);
    expect(sanitized.answeredTools).toBe(1);
  });

  it('pairs by id across a run, not by which message happened to be adjacent', () => {
    // The result of call_2 sits in the message right after call_1's result. An
    // adjacency rule would wave that through even though call_2 is gone.
    const sanitized = sanitizeModelConversationMessages([
      { role: 'assistant', content: [toolCall('call_1')] },
      { role: 'tool', content: [toolResult('call_1', true)] },
      { role: 'tool', content: [toolResult('call_2', true)] },
    ]);

    expect(sanitized.messages).toEqual([
      { role: 'assistant', content: [toolCall('call_1')] },
      { role: 'tool', content: [toolResult('call_1', true)] },
    ]);
    expect(sanitized.droppedMessages).toBe(1);
  });

  it('keeps a mixed tool message and drops only the headless part', () => {
    const sanitized = sanitizeModelConversationMessages([
      { role: 'assistant', content: [toolCall('call_1')] },
      { role: 'tool', content: [toolResult('call_1', true), toolResult('call_x', true)] },
    ]);

    expect(sanitized.messages).toEqual([
      { role: 'assistant', content: [toolCall('call_1')] },
      { role: 'tool', content: [toolResult('call_1', true)] },
    ]);
    expect(sanitized.droppedMessages).toBe(1);
  });

  it('leaves a well-formed conversation untouched', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [toolCall('call_1'), toolCall('call_2')] },
      { role: 'tool', content: [toolResult('call_1', true), toolResult('call_2', true)] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    const sanitized = sanitizeModelConversationMessages(messages);

    expect(sanitized.messages).toEqual(messages);
    expect(sanitized.droppedMessages).toBe(0);
    expect(sanitized.answeredTools).toBe(0);
  });
});
