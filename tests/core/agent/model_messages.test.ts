import { describe, expect, it } from 'vitest';

import { extractTextFromModelMessageContent } from '../../../src/core/agent/model_messages';

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
});
