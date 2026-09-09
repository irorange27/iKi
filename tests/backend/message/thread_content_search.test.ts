// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

const chatDb = await import('@iki/backend/db/chat_thread');
const messageDb = await import('@iki/backend/db/chat_message');
const database = await import('@iki/backend/db/database');

const { searchThreadContent } = await import('@iki/backend/message/thread_content_search');

let dataDir = '';

const addMessage = (threadId: string, id: string, role: string, text: string) => {
  messageDb.addChatMessage({
    id,
    thread_id: threadId,
    message: JSON.stringify({
      id,
      role,
      parts: [{ type: 'text', text }],
    }),
    timestamp: new Date().toISOString(),
    metadata: '{}',
  });
};

describe('searchThreadContent', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-search-'));
    getUserDataPathMock.mockReturnValue(dataDir);
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });

    chatDb.addChatThread({ id: 'thread_a', title: 'Alpha', metadata: '{}' });
    chatDb.addChatThread({ id: 'thread_b', title: 'Beta', metadata: '{}' });

    addMessage('thread_a', 'msg_a1', 'user', 'Please fix the login race condition');
    addMessage('thread_a', 'msg_a2', 'assistant', 'The login race condition was in the session store.');
    addMessage('thread_b', 'msg_b1', 'user', 'Completely unrelated discussion about cooking');
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns per-thread matches with snippets from message text', () => {
    const matches = searchThreadContent('login race condition');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.threadId).toBe('thread_a');
    expect(matches[0]!.threadTitle).toBe('Alpha');
    expect(matches[0]!.snippet).toContain('login race condition');
  });

  it('is case-insensitive and skips empty queries', () => {
    expect(searchThreadContent('RACE')).toHaveLength(1);
    expect(searchThreadContent('  ')).toEqual([]);
  });
});
