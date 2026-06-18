import { describe, expect, it } from 'vitest';

import {
  buildThreadRuntimeMetadata,
  normalizeStringArray,
  parseJsonRecord,
  parseThreadAffectState,
  parseThreadInterventionPolicyState,
  parseThreadToolNames,
  parseThreadToolSelectionState,
} from '@iki/core/chat/thread_runtime_hints';

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

  it('stores and parses structured affect metadata as a first-class runtime hint', () => {
    const metadata = buildThreadRuntimeMetadata({
      existingMetadata: '{}',
      providerType: 'openai',
      model: 'gpt-4.1',
      toolMode: 'auto',
      affectSignal: {
        source: 'realtime',
        guardActive: true,
        state: {
          label: 'anger',
          confidence: 0.82,
          valence: -0.64,
          arousal: 0.77,
          emotions: [{ label: 'anger', score: 0.82 }],
          sampleCount: 3,
          windowSize: 8,
          startAt: '2026-03-22T00:00:00.000Z',
          endAt: '2026-03-22T00:05:00.000Z',
          ageMinutes: 1,
          windowMinutes: 5,
        },
      },
      updatedAt: '2026-03-22T00:06:00.000Z',
    });

    expect(parseThreadAffectState(metadata)).toEqual({
      source: 'realtime',
      guardActive: true,
      updatedAt: '2026-03-22T00:06:00.000Z',
      state: {
        label: 'anger',
        confidence: 0.82,
        valence: -0.64,
        arousal: 0.77,
        emotions: [{ label: 'anger', score: 0.82 }],
        sampleCount: 3,
        windowSize: 8,
        startAt: '2026-03-22T00:00:00.000Z',
        endAt: '2026-03-22T00:05:00.000Z',
        ageMinutes: 1,
        windowMinutes: 5,
      },
    });
  });

  it('stores whether an intervention policy was applied or recorded only for audit', () => {
    const metadata = buildThreadRuntimeMetadata({
      existingMetadata: '{}',
      providerType: 'openai',
      model: 'gpt-4.1',
      toolMode: 'manual',
      interventionPolicy: {
        interventionState: 'co_plan',
        escalate: 0,
        confidence: 0.84,
        rationale: 'Lower pressure next step is safer.',
        reasonCodes: ['affect_blocked'],
        affectUsed: true,
        applied: false,
      },
      updatedAt: '2026-03-22T00:06:00.000Z',
    });

    expect(parseThreadInterventionPolicyState(metadata)).toEqual({
      interventionState: 'co_plan',
      escalate: 0,
      confidence: 0.84,
      rationale: 'Lower pressure next step is safer.',
      reasonCodes: ['affect_blocked'],
      affectUsed: true,
      applied: false,
      updatedAt: '2026-03-22T00:06:00.000Z',
    });
  });
});
