import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getFullSystemPromptMock } = vi.hoisted(() => ({
  getFullSystemPromptMock: vi.fn(),
}));

vi.mock('../../../src/core/provider/llm/factory', () => ({
  getFullSystemPrompt: getFullSystemPromptMock,
}));

import {
  appendApprovalResponsesToHistory,
  appendResponseMessages,
  appendUserPromptToHistory,
  buildPromptContext,
  cloneModelMessages,
  collectApprovalRequests,
} from '../../../src/core/agent/ai_sdk_runtime';

beforeEach(() => {
  vi.clearAllMocks();
  getFullSystemPromptMock.mockReturnValue('persona prompt');
});

describe('ai_sdk_runtime', () => {
  it('builds a combined system prompt and strips system messages from the message list', () => {
    const history = [
      { role: 'system' as const, content: 'thread system' },
      { role: 'user' as const, content: 'hello' },
    ];

    expect(
      buildPromptContext(
        {
          providerType: 'openai',
          systemPrompt: 'runtime system',
        },
        history
      )
    ).toEqual({
      systemPrompt: 'persona prompt\n\nruntime system\n\nthread system',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('clones and appends prompt/approval/response messages without mutating the original history', () => {
    const originalHistory = [{ role: 'user' as const, content: 'hello' }];
    const clonedHistory = cloneModelMessages(originalHistory);
    const promptedHistory = appendUserPromptToHistory(clonedHistory, 'follow up');
    const approvedHistory = appendApprovalResponsesToHistory(promptedHistory, [
      {
        type: 'tool-approval-response',
        approvalId: 'approval_1',
        approved: true,
        reason: 'approved',
      },
    ]);
    const appendedHistory = appendResponseMessages(approvedHistory, [
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]);

    expect(originalHistory).toEqual([{ role: 'user', content: 'hello' }]);
    expect(appendedHistory).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'follow up' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
            reason: 'approved',
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]);
  });

  it('collects tool approval requests and normalizes scalar args', () => {
    expect(
      collectApprovalRequests([
        {
          type: 'tool-approval-request',
          approvalId: 'approval_1',
          toolCall: {
            toolCallId: 'call_1',
            toolName: 'fetch',
            input: 'https://example.com',
          },
        },
      ])
    ).toEqual([
      {
        approvalId: 'approval_1',
        toolCallId: 'call_1',
        toolCall: {
          toolName: 'fetch',
          args: {
            value: 'https://example.com',
          },
        },
      },
    ]);
  });
});
