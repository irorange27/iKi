import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import {
  convertModelMessagesToAgentMessages,
  extractTextFromModelMessageContent,
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
});

describe('convertModelMessagesToAgentMessages', () => {
  it('preserves assistant tool metadata and tool-side results', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'search this' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: { q: 'search this' } },
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCall: { toolName: 'web' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'web',
            output: { ok: true },
          },
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
            reason: 'User approved tool execution.',
          },
        ],
      },
    ] as unknown as ModelMessage[];

    const agentMessages = convertModelMessagesToAgentMessages(messages);

    expect(agentMessages).toHaveLength(5);
    expect(agentMessages[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: 'system prompt',
      })
    );
    expect(agentMessages[1]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: 'search this',
      })
    );
    expect(agentMessages[2]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Checking.',
        metadata: expect.objectContaining({
          toolCalls: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool-call',
              toolCallId: 'call_1',
            }),
          ]),
          toolApprovalRequests: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool-approval-request',
              approvalId: 'approval_1',
            }),
          ]),
        }),
      })
    );
    expect(agentMessages[3]).toEqual(
      expect.objectContaining({
        role: 'tool',
        content: JSON.stringify({ ok: true }),
        metadata: expect.objectContaining({
          toolCallId: 'call_1',
          toolName: 'web',
        }),
      })
    );
    expect(agentMessages[4]).toEqual(
      expect.objectContaining({
        role: 'tool',
        content: JSON.stringify({
          approvalId: 'approval_1',
          approved: true,
          reason: 'User approved tool execution.',
        }),
        metadata: expect.objectContaining({
          approvalId: 'approval_1',
        }),
      })
    );
  });
});
