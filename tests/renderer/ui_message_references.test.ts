import { describe, expect, it } from 'vitest';

import {
  getAffectReferenceSummary,
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
        {
          type: 'dynamic-tool',
          toolCallId: 'call_3',
          toolName: 'load_skill',
          state: 'output-available',
          output: {
            id: 'user:planner',
            name: 'Planner',
            source: 'user',
            content: '<skill>...</skill>',
            truncated: false,
          },
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

  it('does not count transcript-hidden todo planner calls as visible tool references', () => {
    const summary = getToolReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'call_todo_1',
          toolName: 'todo',
          state: 'output-available',
          output: { items: [{ id: '1', text: 'Inspect current code', status: 'completed' }] },
        },
        {
          type: 'tool-result',
          toolCallId: 'call_todo_2',
          toolName: 'todo',
          state: 'output-available',
          output: { items: [{ id: '2', text: 'Implement fix', status: 'in_progress' }] },
        },
        {
          type: 'tool-result',
          toolCallId: 'call_fetch_1',
          toolName: 'fetch',
          state: 'output-available',
          output: { content: 'ok' },
        },
      ],
    } as never);

    expect(summary).toEqual({
      count: 1,
      names: ['fetch'],
      items: [{ name: 'fetch', count: 1 }],
    });
  });

  it('reports loaded skills separately from selected-only skills', () => {
    const summary = getSkillReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'data-skill-usage',
          data: {
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
              {
                id: 'user:planner',
                name: 'Planner',
                description: 'Planning workflow',
                source: 'user',
              },
            ],
          },
        },
        {
          type: 'dynamic-tool',
          toolCallId: 'call_skill_1',
          toolName: 'load_skill',
          state: 'output-available',
          output: {
            id: 'user:planner',
            name: 'Planner',
            source: 'user',
            content: '<skill id="user:planner">...</skill>',
            truncated: false,
          },
        },
      ],
    } as never);

    expect(summary.mode).toBe('auto');
    expect(summary.items).toEqual([
      {
        id: 'user:planner',
        name: 'Planner',
        description: 'Planning workflow',
        source: 'user',
        sourceLabel: 'User',
      },
    ]);
    expect(summary.selectedItems).toEqual([
      {
        id: 'codex:.system/openai-docs',
        name: 'openai-docs',
        description: 'Official OpenAI docs guidance',
        source: 'codex',
        sourceLabel: 'Codex',
      },
      {
        id: 'user:planner',
        name: 'Planner',
        description: 'Planning workflow',
        source: 'user',
        sourceLabel: 'User',
      },
    ]);
    expect(summary.selectedOnlyItems).toEqual([
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
          type: 'data-memory-retrieval',
          data: {
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
        parts: [
          { type: 'data-memory-retrieval', data: { results: [{ summary: 'hello' }] } },
        ],
      } as never)
    ).toBe(true);
  });

  it('parses context assembly reports for reference inspection', () => {
    const summary = getContextReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'data-context-report',
          data: {
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

  it('parses affect signals for reference inspection', () => {
    const summary = getAffectReferenceSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'data-affect-signal',
          data: {
            source: 'realtime',
            guardActive: true,
            label: 'anger',
            confidence: 0.82,
            valence: -0.64,
            arousal: 0.77,
            emotions: [{ label: 'anger', score: 0.82 }],
            sampleCount: 3,
            windowSize: 8,
            ageMinutes: 1,
            windowMinutes: 5,
          },
        },
      ],
    } as never);

    expect(summary).toEqual({
      source: 'realtime',
      guardActive: true,
      label: 'anger',
      confidence: 0.82,
      valence: -0.64,
      arousal: 0.77,
      sampleCount: 3,
      windowSize: 8,
      ageMinutes: 1,
      windowMinutes: 5,
      emotions: [{ label: 'anger', score: 0.82 }],
    });
    expect(
      hasReferenceSummary({
        id: 'assistant_3',
        role: 'assistant',
        parts: [
          {
            type: 'data-affect-signal',
            data: { label: 'anger', confidence: 0.5 },
          },
        ],
      } as never)
    ).toBe(true);
  });

  it('does not expose selected-only skills as executed skill references', () => {
    expect(
      hasReferenceSummary({
        id: 'assistant_skill_only',
        role: 'assistant',
        parts: [
          {
            type: 'data-skill-usage',
            data: {
              mode: 'manual',
              skills: [
                {
                  id: 'user:planner',
                  name: 'Planner',
                  description: 'Planning workflow',
                  source: 'user',
                },
              ],
            },
          },
        ],
      } as never)
    ).toBe(false);
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
            type: 'data-context-report',
            data: {
              totalEstimatedTokens: 640,
              blocks: [{ kind: 'recent-history', status: 'included' }],
            },
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
