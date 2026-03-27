import { describe, expect, it } from 'vitest';

import { toModelInputMessages } from '../../../../src/main/services/chat/chat_ui';

describe('chat_ui message conversion', () => {
  it('strips canonical and legacy metadata parts before AI SDK model conversion', async () => {
    const converted = await toModelInputMessages([
      {
        id: 'assistant_1',
        role: 'assistant',
        parts: [
          {
            type: 'skill-usage',
            mode: 'auto',
            skills: [{ id: 'user:planner', name: 'Planner' }],
          },
          {
            type: 'data-memory-retrieval',
            data: {
              query: 'constraints',
              results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
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
