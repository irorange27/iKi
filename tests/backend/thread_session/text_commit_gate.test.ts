import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: () => profile.path }));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { getSessionEvents } from '@iki/backend/db/session_events';
import {
  MODEL_TEXT_COMMITTED,
  SessionLogCommitError,
} from '@iki/backend/thread_session/session_log';
import * as sessionLog from '@iki/backend/thread_session/session_log';
import { createTextCommitGate } from '@iki/backend/thread_session/text_commit_gate';

const THREAD_ID = 'thread_commit_gate';
const RUN_ID = 'run_commit_gate';
const MESSAGE_ID = 'assistant_commit_gate';

let root = '';
let published: string[] = [];

const buildGate = (overrides: { intervalMs?: number; preview?: string } = {}) =>
  createTextCommitGate({
    threadId: THREAD_ID,
    runId: () => RUN_ID,
    messageId: MESSAGE_ID,
    publish: text => published.push(text),
    previewText: () => overrides.preview ?? '',
    intervalMs: overrides.intervalMs ?? 0,
  });

const committedText = () =>
  getSessionEvents(THREAD_ID, [MODEL_TEXT_COMMITTED]).map(
    event => (event.payload as { text: string }).text
  );

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-commit-gate-'));
  profile.path = root;
  initializeDatabase();
  addWorkspace({ id: 'ws_gate', path: root, name: 'Gate' });
  addChatThread({
    id: THREAD_ID,
    title: 'Gate',
    workspace_id: 'ws_gate',
    metadata: '{}',
    is_generating: 0,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  } as never);
  published = [];
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('createTextCommitGate', () => {
  it('writes the text to the log before publishing it', () => {
    const gate = buildGate();

    gate.buffer('hello');
    gate.flush();

    expect(committedText()).toEqual(['hello']);
    expect(published).toEqual(['hello']);
  });

  it('does not publish anything for an empty flush', () => {
    const gate = buildGate();

    gate.flush();
    gate.flush();

    expect(committedText()).toEqual([]);
    expect(published).toEqual([]);
  });

  it('buffers below the interval and flushes at or above it', () => {
    const gate = buildGate({ intervalMs: 60_000 });

    gate.buffer('a');
    gate.buffer('b');
    expect(committedText()).toEqual([]);

    gate.flush();
    expect(committedText()).toEqual(['ab']);
    expect(published).toEqual(['ab']);
  });

  it('numbers successive commits so a replay can order them', () => {
    const gate = buildGate();

    gate.buffer('one');
    gate.flush();
    gate.buffer('two');
    gate.flush();

    const seqs = getSessionEvents(THREAD_ID, [MODEL_TEXT_COMMITTED]).map(
      event => (event.payload as { seq: number }).seq
    );
    expect(seqs).toEqual([0, 1]);
  });

  it('throws with the unpublished text and publishes nothing when the append fails', () => {
    const gate = buildGate({ preview: 'the preview', intervalMs: 60_000 });
    const append = vi
      .spyOn(sessionLog, 'recordSessionEvents')
      .mockImplementation(() => {
        throw new Error('disk full');
      });

    try {
      gate.buffer('never shown');
      let caught: unknown;
      try {
        gate.flush();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SessionLogCommitError);
      expect((caught as SessionLogCommitError).unpublishedText).toBe('never shown');
      expect((caught as SessionLogCommitError).generatedText).toBe('the preview');
      expect(published).toEqual([]);
    } finally {
      append.mockRestore();
    }

    // The same gate recovers once the append succeeds: the buffered text was
    // not lost, and the failed attempt consumed no sequence number.
    gate.buffer('ok');
    gate.flush();
    expect(published).toEqual(['never shownok']);
  });
});
