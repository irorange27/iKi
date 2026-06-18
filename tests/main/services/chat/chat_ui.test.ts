import { describe, expect, it } from 'vitest';

import {
  parseStoredUiMessageRow,
  sanitizeUiMessageJsonForStorage,
} from '../../../../src/shared/chat/ui_message_codec';

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
        {
          type: 'composer-invocation',
          tokens: [
            {
              id: 'skill:codex:frontend-dev',
              kind: 'skill',
              prefix: '$',
              label: 'frontend-dev',
            },
          ],
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
        type: 'data-skill-usage',
        data: {
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
      },
      {
        type: 'data-memory-retrieval',
        data: {
          query: 'project constraints',
          results: [{ id: 'mem_1', summary: 'Prefer maintainable changes.', score: 0.82 }],
        },
      },
      {
        type: 'data-composer-invocation',
        data: {
          tokens: [
            {
              id: 'skill:codex:frontend-dev',
              kind: 'skill',
              prefix: '$',
              label: 'frontend-dev',
            },
          ],
        },
      },
      { type: 'text', text: 'Final answer.' },
    ]);
  });

  it('canonicalizes legacy content-only messages into AI SDK text parts', () => {
    const raw = JSON.stringify({
      role: 'user',
      content: 'hello from history',
    });

    expect(sanitizeUiMessageJsonForStorage(raw)).toBe(
      JSON.stringify({
        role: 'user',
        parts: [{ type: 'text', text: 'hello from history' }],
      })
    );
  });

  it('leaves unsupported non-UI roles unchanged instead of coercing them', () => {
    const raw = JSON.stringify({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'tool_1', output: { ok: true } }],
    });

    expect(sanitizeUiMessageJsonForStorage(raw)).toBe(raw);
  });
});
