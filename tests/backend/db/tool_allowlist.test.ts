import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '@iki/backend/db/database';
import {
  addToolAllowlistEntry,
  listToolAllowPatterns,
  removeToolAllowlistEntry,
} from '@iki/backend/db/tool_allowlist';

const getDbMock = vi.mocked(getDb);

const mockDb = (overrides: { all?: ReturnType<typeof vi.fn>; run?: ReturnType<typeof vi.fn> }) => {
  const all = overrides.all ?? vi.fn(() => []);
  const run = overrides.run ?? vi.fn(() => ({ changes: 1 }));
  getDbMock.mockReturnValue({ prepare: () => ({ all, run }) } as unknown as ReturnType<typeof getDb>);
  return { all, run };
};

describe('tool_allowlist patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves a newly added rule instead of a stale memo', () => {
    const { all } = mockDb({});
    all.mockReturnValue([{ pattern: '{"path":"a"}' }]);
    expect(listToolAllowPatterns('write_file')).toEqual(['{"path":"a"}']);

    // The memo must not outlive a write: a learned rule that never shows up is
    // a silent permission hole.
    all.mockReturnValue([{ pattern: '{"path":"b"}' }, { pattern: '{"path":"a"}' }]);
    addToolAllowlistEntry({ toolName: 'write_file', pattern: '{"path":"b"}' });

    expect(listToolAllowPatterns('write_file')).toEqual(['{"path":"b"}', '{"path":"a"}']);
  });

  it('drops a removed rule instead of a stale memo', () => {
    const { all } = mockDb({});
    all.mockReturnValue([{ pattern: '{"path":"a"}' }]);
    expect(listToolAllowPatterns('edit')).toEqual(['{"path":"a"}']);

    all.mockReturnValue([]);
    removeToolAllowlistEntry('rule_1');

    expect(listToolAllowPatterns('edit')).toEqual([]);
  });

  it('reads the database once per tool name until a write lands', () => {
    const { all } = mockDb({});
    all.mockReturnValue([{ pattern: '{"path":"a"}' }]);

    listToolAllowPatterns('read_file');
    listToolAllowPatterns('read_file');

    expect(all).toHaveBeenCalledTimes(1);
  });
});
