import { describe, expect, it } from 'vitest';

import { estimateToolSchemaTokens } from '@iki/backend/agent/context_budget';
import { summarizeContextComposition } from '@iki/backend/turn_prep/context_helpers';
import type { AgentTool } from '@iki/backend/agent/types';
import type { ContextReport } from '@iki/backend/turn_prep/context_types';

const makeTool = (overrides: Partial<AgentTool> & { name: string }): AgentTool =>
  ({
    type: 'function',
    description: `description for ${overrides.name}`,
    parameters: { type: 'object', properties: {} },
    handler: async () => ({}),
    ...overrides,
  }) as AgentTool;

const makeReport = (blocks: ContextReport['blocks']): ContextReport => ({
  totalEstimatedTokens: blocks.reduce((sum, block) => sum + block.estimatedTokens, 0),
  retainedRecentMessages: 4,
  compactedMessages: 0,
  blocks,
});

describe('context composition summary', () => {
  it('splits tool schema estimates by builtin and mcp origin', () => {
    const totals = estimateToolSchemaTokens([
      makeTool({ name: 'read_file' }),
      makeTool({ name: 'run_command' }),
      makeTool({
        name: 'mcp_search',
        source: { kind: 'mcp', id: 'server_a', name: 'search' },
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'a longer description to add tokens' },
          },
        },
      }),
    ]);

    expect(totals.builtin).toBeGreaterThan(0);
    expect(totals.mcp).toBeGreaterThan(totals.builtin / 4);
  });

  it('maps context report blocks onto composition categories', () => {
    const summary = summarizeContextComposition({
      report: makeReport([
        { kind: 'recent-history', status: 'included', estimatedTokens: 5760, charCount: 0 },
        { kind: 'identity', status: 'included', estimatedTokens: 900, charCount: 0 },
        { kind: 'skills', status: 'included', estimatedTokens: 300, charCount: 0 },
        { kind: 'memory', status: 'included', estimatedTokens: 80, charCount: 0 },
        { kind: 'affect', status: 'dropped', estimatedTokens: 0, charCount: 0 },
        { kind: 'clipboard', status: 'included', estimatedTokens: 40, charCount: 0 },
      ]),
      toolSchemaTokens: { builtin: 440, mcp: 120 },
    });

    expect(summary.categories).toEqual({
      messages: 5760,
      systemPrompt: 900,
      skills: 300,
      memory: 80,
      tools: 440,
      mcpTools: 120,
      other: 40,
    });
    expect(summary.estimatedTotalTokens).toBe(7640);
  });

  it('omits zero categories and tolerates a missing tool estimate', () => {
    const summary = summarizeContextComposition({
      report: makeReport([
        { kind: 'recent-history', status: 'included', estimatedTokens: 1200, charCount: 0 },
        { kind: 'memory', status: 'dropped', estimatedTokens: 0, charCount: 0 },
      ]),
      toolSchemaTokens: null,
    });

    expect(summary.categories).toEqual({ messages: 1200 });
    expect(summary.estimatedTotalTokens).toBe(1200);
  });
});
