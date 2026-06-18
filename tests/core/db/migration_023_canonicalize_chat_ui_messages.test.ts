import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredRow = {
  id: string;
  message: string;
};

const { state, getDbMock } = vi.hoisted(() => ({
  state: {
    rows: [] as StoredRow[],
    updated: [] as StoredRow[],
  },
  getDbMock: vi.fn(),
}));

vi.mock('@iki/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('023_canonicalize_chat_ui_messages migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    state.updated = [];
    state.rows = [
      {
        id: 'msg_legacy',
        message: JSON.stringify({
          role: 'assistant',
          parts: [
            {
              type: 'skill-usage',
              mode: 'auto',
              skills: [{ id: 'user:planner', name: 'Planner' }],
            },
            { type: 'text', text: 'done' },
          ],
        }),
      },
      {
        id: 'msg_content',
        message: JSON.stringify({
          role: 'user',
          content: 'hello from older storage',
        }),
      },
      {
        id: 'msg_invalid',
        message: JSON.stringify({
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'call_1', output: { ok: true } }],
        }),
      },
      {
        id: 'msg_canonical',
        message: JSON.stringify({
          role: 'assistant',
          parts: [{ type: 'text', text: 'already canonical' }],
        }),
      },
    ];

    const prepareMock = vi.fn((sql: string) => {
      if (sql === 'SELECT id, message FROM chat_messages ORDER BY created_at ASC, id ASC') {
        return {
          all: () => state.rows,
        };
      }

      if (sql === 'UPDATE chat_messages SET message = ? WHERE id = ?') {
        return {
          run: (message: string, id: string) => {
            state.updated.push({ id, message });
            state.rows = state.rows.map(row => (row.id === id ? { ...row, message } : row));
          },
        };
      }

      throw new Error(`Unexpected SQL in 023 migration test: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
      transaction: vi.fn((fn: (rows: StoredRow[]) => void) => fn),
    });
  });

  it('canonicalizes only rows that actually need chat UI storage normalization', async () => {
    const { migration } = await import(
      '../../../packages/core/src/db/migration/023_canonicalize_chat_ui_messages'
    );

    migration.up();

    expect(state.updated).toEqual([
      {
        id: 'msg_legacy',
        message: JSON.stringify({
          role: 'assistant',
          parts: [
            {
              type: 'data-skill-usage',
              data: {
                mode: 'auto',
                skills: [{ id: 'user:planner', name: 'Planner' }],
              },
            },
            { type: 'text', text: 'done' },
          ],
        }),
      },
      {
        id: 'msg_content',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'hello from older storage' }],
        }),
      },
    ]);
  });
});
