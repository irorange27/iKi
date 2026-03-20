import { describe, expect, it } from 'vitest';

import {
  getContextReferenceSummary,
  getMemoryReferenceSummary,
  getSkillReferenceSummary,
  getToolReferenceSummary,
  hasReferenceSummary,
} from '../../src/renderer/modules/chat/ui_message_references';

describe('ui_message_references', () => {
  it('counts unique tool calls while preserving readable tool names', () => {
    const summary = getToolReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call_1',
          toolName: 'web',
          state: 'input-available',
        },
        {
          type: 'dynamic-tool',
          toolCallId: 'call_1',
          toolName: 'web',
          state: 'output-available',
        },
        {
          type: 'dynamic-tool',
          toolCallId: 'call_2',
          toolName: 'fetch',
          state: 'output-available',
        },
      ],
    } as never);

    expect(summary).toEqual({
      count: 2,
      names: ['web', 'fetch'],
      items: [
        { name: 'web', count: 1 },
        { name: 'fetch', count: 1 },
      ],
    });
  });

  it('deduplicates skill references and keeps the selection mode', () => {
    const summary = getSkillReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'skill-usage',
          mode: 'auto',
          skills: [
            {
              id: 'codex:.system/openai-docs',
              name: 'openai-docs',
              description: 'Official OpenAI docs guidance',
              source: 'codex',
            },
            {
              id: 'codex:.system/openai-docs',
              name: 'openai-docs',
              description: 'Duplicate',
              source: 'codex',
            },
          ],
        },
      ],
    } as never);

    expect(summary.mode).toBe('auto');
    expect(summary.items).toEqual([
      {
        id: 'codex:.system/openai-docs',
        name: 'openai-docs',
        description: 'Official OpenAI docs guidance',
        source: 'codex',
        sourceLabel: 'Codex',
      },
    ]);
  });

  it('normalizes memory references including tags and source counts', () => {
    const summary = getMemoryReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'memory-retrieval',
          query: 'project constraints',
          results: [
            {
              id: 'mem_1',
              summary: 'User prefers long-term maintainable solutions.',
              score: '0.834',
              updated_at: '2026-03-19T12:00:00.000Z',
              tags: '["preference","engineering"]',
              sourceMessageCount: 2,
            },
          ],
        },
      ],
    } as never);

    expect(summary).toEqual({
      query: 'project constraints',
      items: [
        {
          id: 'mem_1',
          summary: 'User prefers long-term maintainable solutions.',
          score: 0.834,
          updatedAt: '2026-03-19T12:00:00.000Z',
          tags: ['preference', 'engineering'],
          sourceMessageCount: 2,
        },
      ],
    });
    expect(
      hasReferenceSummary({
        id: 'assistant_1',
        role: 'assistant',
        parts: [{ type: 'memory-retrieval', results: [{ summary: 'hello' }] }],
      } as never)
    ).toBe(true);
  });

  it('parses context assembly reports for reference inspection', () => {
    const summary = getContextReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'context-report',
          totalEstimatedTokens: 640,
          retainedRecentMessages: 6,
          compactedMessages: 12,
          blocks: [
            {
              kind: 'recent-history',
              status: 'truncated',
              estimatedTokens: 220,
              charCount: 880,
              reason: 'compacted older turns into summary/recent window',
              sourceCount: 6,
            },
            {
              kind: 'thread-summary',
              status: 'included',
              estimatedTokens: 180,
              charCount: 720,
              sourceCount: 12,
            },
          ],
        },
      ],
    } as never);

    expect(summary).toEqual({
      totalEstimatedTokens: 640,
      retainedRecentMessages: 6,
      compactedMessages: 12,
      items: [
        {
          kind: 'recent-history',
          status: 'truncated',
          estimatedTokens: 220,
          charCount: 880,
          reason: 'compacted older turns into summary/recent window',
          sourceCount: 6,
        },
        {
          kind: 'thread-summary',
          status: 'included',
          estimatedTokens: 180,
          charCount: 720,
          reason: '',
          sourceCount: 12,
        },
      ],
    });
  });
});
