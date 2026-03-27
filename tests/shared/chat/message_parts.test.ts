import { describe, expect, it } from 'vitest';

import {
  isChatUiMetadataPart,
  normalizeChatUiMetadataPart,
} from '../../../src/shared/chat/message_parts';

describe('message_parts', () => {
  it('recognizes both canonical and legacy chat metadata parts', () => {
    expect(isChatUiMetadataPart({ type: 'skill-usage', skills: [] })).toBe(true);
    expect(isChatUiMetadataPart({ type: 'data-skill-usage', data: { skills: [] } })).toBe(true);
    expect(isChatUiMetadataPart({ type: 'text', text: 'hello' })).toBe(false);
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
        type: 'data-context-report',
        data: {
          totalEstimatedTokens: 320,
          blocks: [{ kind: 'memory', status: 'included' }],
        },
      },
    ]);
  });
});
