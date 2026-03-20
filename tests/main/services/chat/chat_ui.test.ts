import { describe, expect, it } from 'vitest';

import { sanitizeUiMessageJsonForStorage } from '../../../../src/main/services/chat/chat_ui';
import { parseStoredUiMessageRow } from '../../../../src/shared/chat/ui_message_codec';

describe('chat_ui message serialization', () => {
  it('preserves skill and memory citation parts for persistence and reload', () => {
    const raw = JSON.stringify({
      role: 'assistant',
      parts: [
        {
          type: 'skill-usage',
          mode: 'auto',
          skills: [
            {
              id: 'codex:.system/openai-docs',
              name: 'openai-docs',
              description: 'Official docs guidance',
              source: 'codex',
            },
          ],
        },
        {
          type: 'memory-retrieval',
          query: 'project constraints',
          results: [{ id: 'mem_1', summary: 'Prefer maintainable changes.', score: 0.82 }],
        },
        { type: 'text', text: 'Final answer.' },
      ],
    });

    const sanitized = sanitizeUiMessageJsonForStorage(raw);
    const parsed = parseStoredUiMessageRow({
      id: 'msg_1',
      message: sanitized,
    });

    expect(parsed.parts).toEqual([
      {
        type: 'skill-usage',
        mode: 'auto',
        skills: [
          {
            id: 'codex:.system/openai-docs',
            name: 'openai-docs',
            description: 'Official docs guidance',
            source: 'codex',
          },
        ],
      },
      {
        type: 'memory-retrieval',
        query: 'project constraints',
        results: [{ id: 'mem_1', summary: 'Prefer maintainable changes.', score: 0.82 }],
      },
      { type: 'text', text: 'Final answer.' },
    ]);
  });
});
