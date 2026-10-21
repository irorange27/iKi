import { describe, expect, it } from 'vitest';

import {
  extractTextFromMessageParts,
  isChatUiMetadataPart,
  isSkillUsagePart,
  normalizeChatUiMetadataPart,
} from '@iki/backend/message/message_parts';

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
          type: 'token-usage',
          inputTokens: 320,
          maxInputTokens: 128000,
          model: 'gpt-5-mini',
        },
        {
          type: 'context-report',
          totalEstimatedTokens: 320,
          blocks: [{ kind: 'skills', status: 'included' }],
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
          blocks: [{ kind: 'skills', status: 'included' }],
        },
      },
    ]);
  });

  it('keeps canonical metadata parts canonical through the boundary normalizer', () => {
    const part = normalizeChatUiMetadataPart({
      type: 'data-token-usage',
      data: { inputTokens: 320, maxInputTokens: 128000 },
    });

    expect(part).toEqual({
      type: 'data-token-usage',
      data: { inputTokens: 320, maxInputTokens: 128000 },
    });
  });

  it('drops metadata parts whose subsystem is gone instead of resurrecting them', () => {
    // Memory and affect are removed; a legacy blob that still carries their
    // parts must normalize to null rather than inventing a part with no owner.
    expect(
      normalizeChatUiMetadataPart({
        type: 'memory-retrieval',
        query: 'constraints',
        results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
      })
    ).toBeNull();
    expect(
      normalizeChatUiMetadataPart({
        type: 'data-affect-signal',
        data: { source: 'history', label: 'anger', confidence: 0.4 },
      })
    ).toBeNull();
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
        { type: 'data-skill-usage', data: { skills: [{ id: 's', name: 'hidden' }] } },
        { type: 'text', text: 'Beta' },
      ])
    ).toBe('Alpha Beta');
  });
});
