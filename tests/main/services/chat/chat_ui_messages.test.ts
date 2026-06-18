import { describe, expect, it } from 'vitest';

import { toModelInputMessages } from '../../../../src/main/services/chat/ui_messages';

describe('chat_ui message conversion', () => {
  it('strips canonical metadata parts before AI SDK model conversion', async () => {
    const converted = await toModelInputMessages([
      {
        id: 'assistant_1',
        role: 'assistant',
        parts: [
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
            type: 'data-composer-invocation',
            data: {
              tokens: [{ id: 'prompt_music', kind: 'prompt-app', prefix: '', label: 'music' }],
            },
          },
          { type: 'text', text: 'Final answer.' },
        ],
      },
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0]?.role).toBe('assistant');
    expect(converted[0]?.content).toEqual([{ type: 'text', text: 'Final answer.' }]);
  });
});
