// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: () => profile.path }));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { truncateAfterMessage } from '@iki/backend/thread_session/history_truncation';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';

const THREAD_ID = 'thread_truncate';

const seed = (ids: string[]) => {
  const persistence = createChatPersistence();
  for (const id of ids) {
    persistence.createMessage({
      id,
      thread_id: THREAD_ID,
      message: { id, role: 'user', parts: [{ type: 'text', text: id }] },
    });
  }
  return persistence;
};

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-truncate-'));
  profile.path = root;
  initializeDatabase();
  addWorkspace({ id: 'ws_truncate', path: root, name: 'Truncate' });
  addChatThread({
    id: THREAD_ID,
    title: 'Truncate',
    workspace_id: 'ws_truncate',
    metadata: '{}',
    is_generating: 0,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  } as never);
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('edit/resend truncation', () => {
  it('removes the messages after the anchor from the display projection', () => {
    const persistence = seed(['m1', 'm2', 'm3']);
    expect(persistence.listMessages(THREAD_ID).map(row => row.id)).toEqual(['m1', 'm2', 'm3']);

    const result = truncateAfterMessage(THREAD_ID, 'm1');

    expect(result).toEqual({ success: true, deletedIds: ['m2', 'm3'] });
    expect(persistence.listMessages(THREAD_ID).map(row => row.id)).toEqual(['m1']);
  });

  it('removes the same messages from the replay projection', () => {
    seed(['m1', 'm2', 'm3']);

    truncateAfterMessage(THREAD_ID, 'm1');

    expect(rebuildThreadViewFromEvents(THREAD_ID).messages.map(message => message.id)).toEqual([
      'm1',
    ]);
  });

  it('keeps the anchor message, which is the one being edited', () => {
    const persistence = seed(['m1', 'm2']);
    truncateAfterMessage(THREAD_ID, 'm2');
    expect(persistence.listMessages(THREAD_ID).map(row => row.id)).toEqual(['m1', 'm2']);
  });

  it('is idempotent for an anchor that no longer exists', () => {
    const persistence = seed(['m1']);
    expect(truncateAfterMessage(THREAD_ID, 'gone')).toEqual({ success: true, deletedIds: [] });
    expect(persistence.listMessages(THREAD_ID).map(row => row.id)).toEqual(['m1']);
  });

  it('refuses an unknown thread without writing a fact', () => {
    seed(['m1']);
    expect(truncateAfterMessage('thread_missing', 'm1')).toEqual({
      success: false,
      deletedIds: [],
      error: 'Thread not found',
    });
  });
});
