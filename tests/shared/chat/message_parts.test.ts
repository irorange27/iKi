import { describe, expect, it } from 'vitest';

import {
  extractTextFromMessageParts,
  isChatUiMetadataPart,
  isSkillUsagePart,
  normalizeChatUiMetadataPart,
} from '../../../src/shared/chat/message_parts';

describe('message_parts', () => {
  it('recognizes canonical chat metadata parts but not legacy flat runtime parts', () => {
    expect(isChatUiMetadataPart({ type: 'skill-usage', skills: [] })).toBe(false);
    expect(isChatUiMetadataPart({ type: 'data-skill-usage', data: { skills: [] } })).toBe(true);
    expect(isChatUiMetadataPart({ type: 'text', text: 'hello' })).toBe(false);
    expect(isSkillUsagePart({ type: 'skill-usage', skills: [] })).toBe(false);
  });

  it('canonicalizes legacy metadata parts into AI SDK data parts', () => {
    expect(
      [
        {
          type: 'skill-usage',
          mode: 'auto',
          skills: [{ id: 'user:planner', name: 'Planner' }],
        },
        {
          type: 'memory-retrieval',
          query: 'constraints',
          results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
        },
        {
          type: 'affect-signal',
          source: 'history',
          label: 'anger',
          confidence: 0.4,
        },
        {
          type: 'token-usage',
          inputTokens: 320,
          maxInputTokens: 128000,
          model: 'gpt-5-mini',
        },
        {
          type: 'context-report',
          totalEstimatedTokens: 320,
          blocks: [{ kind: 'memory', status: 'included' }],
        },
      ].map(part => normalizeChatUiMetadataPart(part))
    ).toEqual([
      {
        type: 'data-skill-usage',
        data: {
          mode: 'auto',
          skills: [{ id: 'user:planner', name: 'Planner' }],
        },
      },
      {
        type: 'data-memory-retrieval',
        data: {
          query: 'constraints',
          results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
        },
      },
      {
        type: 'data-affect-signal',
        data: {
          source: 'history',
          label: 'anger',
          confidence: 0.4,
        },
      },
      {
        type: 'data-token-usage',
        data: {
          inputTokens: 320,
          maxInputTokens: 128000,
          model: 'gpt-5-mini',
        },
      },
      {
        type: 'data-context-report',
        data: {
          totalEstimatedTokens: 320,
          blocks: [{ kind: 'memory', status: 'included' }],
        },
      },
    ]);
  });

  it('keeps canonical metadata parts canonical through the boundary normalizer', () => {
    const part = normalizeChatUiMetadataPart({
      type: 'data-memory-retrieval',
      data: {
        query: 'constraints',
        results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
      },
    });

    expect(part).toEqual({
      type: 'data-memory-retrieval',
      data: {
        query: 'constraints',
        results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
      },
    });
  });

  it('extracts transcript text from text parts only', () => {
    expect(
      extractTextFromMessageParts([
        { type: 'data-token-usage', data: { inputTokens: 320, maxInputTokens: 128000 } },
        { type: 'text', text: 'Alpha ' },
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'web',
          state: 'output-available',
          output: { results: [] },
        },
        { type: 'data-memory-retrieval', data: { results: [{ summary: 'hidden' }] } },
        { type: 'text', text: 'Beta' },
      ])
    ).toBe('Alpha Beta');
  });
});
