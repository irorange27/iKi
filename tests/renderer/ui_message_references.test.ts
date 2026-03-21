import { describe, expect, it } from 'vitest';

import {
  buildContextUsageIndicator,
  formatContextTokenCount,
  getContextReferenceSummary,
  getContextBudgetTokens,
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

  it('formats total context token counts for compact UI labels', () => {
    expect(formatContextTokenCount(640)).toBe('640 tok');
    expect(formatContextTokenCount(12345.9)).toBe('12,345 tok');
    expect(formatContextTokenCount(null)).toBe('');
  });

  it('builds a compact context-usage indicator with percent and tooltip details', () => {
    const indicator = buildContextUsageIndicator(
      {
        totalEstimatedTokens: 640,
        retainedRecentMessages: 6,
        compactedMessages: 12,
        items: [
          {
            kind: 'recent-history',
            status: 'truncated',
            estimatedTokens: 220,
            charCount: 880,
            reason: 'compacted older turns',
            sourceCount: 6,
          },
        ],
      },
      {
        maxRecentTokens: 2400,
        maxRelationshipTokens: 220,
        maxSummaryTokens: 500,
        maxMemoryTokens: 500,
        maxSkillTokens: 1200,
      }
    );

    expect(indicator).toEqual(
      expect.objectContaining({
        usedTokens: 640,
        budgetTokens: 4820,
        percent: 13,
        percentLabel: '13%',
        tokenLabel: '640 tok',
      })
    );
    expect(indicator?.tooltip).toContain('Context usage: 640 tok / 4,820 tok (13%)');
    expect(indicator?.tooltip).toContain(
      'recent-history: truncated · 220 tok · compacted older turns'
    );
  });

  it('does not treat context-only metadata as an expandable reference summary', () => {
    expect(
      hasReferenceSummary({
        id: 'assistant_2',
        role: 'assistant',
        parts: [
          {
            type: 'context-report',
            totalEstimatedTokens: 640,
            blocks: [{ kind: 'recent-history', status: 'included' }],
          },
        ],
      } as never)
    ).toBe(false);
  });

  it('sums the configured context budget buckets', () => {
    expect(
      getContextBudgetTokens({
        maxRecentTokens: 2400,
        maxRelationshipTokens: 220,
        maxSummaryTokens: 500,
        maxMemoryTokens: 500,
        maxSkillTokens: 1200,
      })
    ).toBe(4820);
  });
});
