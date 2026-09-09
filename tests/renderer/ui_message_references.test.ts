import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '@iki/backend/utils/provider_models';

import {
  buildSessionPerfStats,
  getAffectReferenceSummary,
  buildTokenUsageIndicator,
  formatTokenCount,
  getMemoryReferenceSummary,
  getSkillReferenceSummary,
  getTokenUsageSummary,
  getToolReferenceSummary,
  hasReferenceSummary,
} from '../../packages/desktop/src/renderer/modules/chat/ui_message_references';

describe('ui_message_references', () => {
  it('reports tool call counts separately from tool types', () => {
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
      callCount: 2,
      kindCount: 2,
      names: ['web', 'fetch'],
      items: [
        { name: 'web', callCount: 1 },
        { name: 'fetch', callCount: 1 },
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
      callCount: 1,
      kindCount: 1,
      names: ['fetch'],
      items: [{ name: 'fetch', callCount: 1 }],
    });
  });

  it('keeps repeated calls of the same tool distinct from the tool kind count', () => {
    const summary = getToolReferenceSummary({
      id: 'assistant_2',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call_web_1',
          toolName: 'web',
          state: 'output-available',
        },
        {
          type: 'dynamic-tool',
          toolCallId: 'call_web_2',
          toolName: 'web',
          state: 'output-available',
        },
      ],
    } as never);

    expect(summary).toEqual({
      callCount: 2,
      kindCount: 1,
      names: ['web'],
      items: [{ name: 'web', callCount: 2 }],
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

  it('parses token usage reports for composer inspection', () => {
    const summary = getTokenUsageSummary({
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'data-token-usage',
          data: {
            inputTokens: 640,
            outputTokens: 82,
            totalTokens: 722,
            cacheReadTokens: 128,
            reasoningTokens: 44,
            estimatedCostUsd: 0.0123,
            maxInputTokens: 128000,
            model: 'gpt-5-mini',
            providerType: 'openai',
            providerId: 'provider_openai',
            llmMs: 2100,
            toolMs: 300,
            firstTokenMs: 10800,
            firstTokenSamples: 2,
            steps: 4,
            toolCalls: 3,
          },
        },
      ],
    } as never);

    expect(summary).toEqual({
      inputTokens: 640,
      outputTokens: 82,
      totalTokens: 722,
      cacheReadTokens: 128,
      cacheWriteTokens: null,
      reasoningTokens: 44,
      estimatedCostUsd: 0.0123,
      maxInputTokens: 128000,
      maxOutputTokens: null,
      model: 'gpt-5-mini',
      providerType: 'openai',
      providerId: 'provider_openai',
      llmMs: 2100,
      toolMs: 300,
      firstTokenMs: 10800,
      firstTokenSamples: 2,
      steps: 4,
      toolCalls: 3,
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

  it('formats token counts for compact UI labels', () => {
    expect(formatTokenCount(640)).toBe('640 tok');
    expect(formatTokenCount(12345.9)).toBe('12,345 tok');
    expect(formatTokenCount(null)).toBe('');
  });

  it('builds a compact context-usage indicator from actual input token usage', () => {
    const indicator = buildTokenUsageIndicator(
      {
        inputTokens: 640,
        outputTokens: 32,
        totalTokens: 672,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
        estimatedCostUsd: null,
        maxInputTokens: 4600,
        maxOutputTokens: null,
        model: 'gpt-5-mini',
        providerType: 'openai',
        providerId: '',
        llmMs: null,
        toolMs: null,
        firstTokenMs: null,
        firstTokenSamples: null,
        steps: null,
        toolCalls: null,
      }
    );

    expect(indicator).toEqual(
      expect.objectContaining({
        usedTokens: 640,
        budgetTokens: 4600,
        percent: 14,
        percentLabel: '14%',
        tokenLabel: '640 tok',
      })
    );
    expect(indicator?.tooltip).toContain('Context usage: 640 tok / 4,600 tok (14%)');
    expect(indicator?.tooltip).toContain('Output tokens: 32 tok');
    expect(indicator?.tooltip).toContain('Total tokens: 672 tok');
    expect(indicator?.tooltip).toContain('Model: gpt-5-mini');
  });

  it('falls back to the shared 128k default when token usage metadata omits a budget', () => {
    const indicator = buildTokenUsageIndicator({
      inputTokens: 640,
      outputTokens: null,
      totalTokens: 640,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      estimatedCostUsd: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      model: 'gpt-unknown',
      providerType: 'openai',
      providerId: '',
      llmMs: null,
      toolMs: null,
      firstTokenMs: null,
      firstTokenSamples: null,
      steps: null,
      toolCalls: null,
    });

    expect(indicator).toEqual(
      expect.objectContaining({
        usedTokens: 640,
        budgetTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
        percent: 1,
        percentLabel: '1%',
      })
    );
    expect(indicator?.tooltip).toContain('Context usage: 640 tok / 128,000 tok (1%)');
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
    expect(
      hasReferenceSummary({
        id: 'assistant_usage_only',
        role: 'assistant',
        parts: [
          {
            type: 'data-token-usage',
            data: {
              inputTokens: 1200,
              totalTokens: 1330,
              maxInputTokens: 128000,
            },
          },
        ],
      } as never)
    ).toBe(false);
  });

  it('returns null when no token usage metadata is present', () => {
    expect(
      buildTokenUsageIndicator({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
        estimatedCostUsd: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        model: '',
        providerType: '',
        providerId: '',
        llmMs: null,
        toolMs: null,
        firstTokenMs: null,
        firstTokenSamples: null,
        steps: null,
        toolCalls: null,
      })
    ).toBeNull();
  });
});

describe('buildSessionPerfStats', () => {
  const usagePart = (data: Record<string, unknown>) => ({ type: 'data-token-usage', data });

  it('returns null when no assistant message carries usage data', () => {
    expect(
      buildSessionPerfStats([
        { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
      ])
    ).toBeNull();
  });

  it('aggregates token and perf sums across turns and derives rates', () => {
    const stats = buildSessionPerfStats([
      { role: 'user', parts: [] },
      {
        role: 'assistant',
        parts: [
          usagePart({
            inputTokens: 500,
            outputTokens: 100,
            totalTokens: 600,
            cacheReadTokens: 400,
            steps: 3,
            toolCalls: 2,
            llmMs: 2000,
            toolMs: 500,
            firstTokenMs: 9000,
            firstTokenSamples: 3,
            model: 'gpt-5-mini',
          }),
        ],
      },
      {
        role: 'assistant',
        parts: [
          usagePart({
            inputTokens: 300,
            outputTokens: 50,
            totalTokens: 350,
            cacheReadTokens: 200,
            steps: 2,
            llmMs: 1000,
            firstTokenMs: 3000,
            firstTokenSamples: 1,
          }),
        ],
      },
      // Pre-instrumentation message without a usage part contributes nothing.
      { role: 'assistant', parts: [{ type: 'text', text: 'legacy' }] },
    ]);

    expect(stats).toEqual({
      rounds: 2,
      steps: 5,
      toolCalls: 2,
      llmMs: 3000,
      toolMs: 500,
      avgFirstTokenMs: 3000,
      tokensPerSecond: 50,
      cacheHitPercent: 75,
      inputTokens: 800,
      outputTokens: 150,
      totalTokens: 950,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
      model: 'gpt-5-mini',
    });
  });

  it('keeps derived rates null when only token data exists', () => {
    const stats = buildSessionPerfStats([
      {
        role: 'assistant',
        parts: [usagePart({ inputTokens: 100, outputTokens: 10, totalTokens: 110 })],
      },
    ]);

    expect(stats).not.toBeNull();
    expect(stats?.rounds).toBe(1);
    expect(stats?.avgFirstTokenMs).toBeNull();
    expect(stats?.tokensPerSecond).toBeNull();
    expect(stats?.cacheHitPercent).toBe(0);
  });
});
