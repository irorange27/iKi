import { describe, expect, it } from 'vitest';

import {
  buildThreadRuntimeMetadata,
  normalizeStringArray,
  parseJsonRecord,
  parseThreadToolNames,
  parseThreadToolSelectionState,
} from '../../../src/shared/chat/thread_runtime_hints';

describe('thread_runtime_hints', () => {
  it('normalizes string arrays by trimming and de-duplicating values', () => {
    expect(normalizeStringArray([' web ', '', 'fetch', 'web', 1, null])).toEqual([
      'web',
      'fetch',
    ]);
  });

  it('parses persisted thread tool hints from thread fields', () => {
    expect(parseThreadToolNames('["web","mcp_lookup","web"]')).toEqual(['web', 'mcp_lookup']);
    expect(
      parseThreadToolSelectionState(
        JSON.stringify({
          toolSelection: {
            mode: 'manual',
            mcpServerIds: [' docs ', 'docs', 'search'],
          },
        })
      )
    ).toEqual({
      mode: 'manual',
      mcpServerIds: ['docs', 'search'],
    });
  });

  it('builds next runtime metadata without dropping unrelated metadata', () => {
    const existing = parseJsonRecord(
      JSON.stringify({
        source: 'desktop',
        llm: {
          providerType: 'openai',
          model: 'gpt-4.1',
          updatedAt: '2026-03-21T00:00:00.000Z',
        },
        toolSelection: {
          mode: 'auto',
          mcpServerIds: ['legacy'],
          pinned: true,
        },
      })
    );

    expect(
      buildThreadRuntimeMetadata({
        existingMetadata: existing,
        providerType: 'deepseek',
        model: 'deepseek-chat',
        toolMode: 'manual',
        mcpServerIds: [' docs ', 'docs'],
        updatedAt: '2026-03-22T00:00:00.000Z',
      })
    ).toEqual({
      source: 'desktop',
      llm: {
        providerType: 'deepseek',
        model: 'deepseek-chat',
        updatedAt: '2026-03-22T00:00:00.000Z',
      },
      toolSelection: {
        mode: 'manual',
        mcpServerIds: ['docs'],
        pinned: true,
        updatedAt: '2026-03-22T00:00:00.000Z',
      },
    });
  });
});
