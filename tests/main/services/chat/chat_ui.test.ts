// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '@iki/store/database';
import { normalizeUiMessage } from '@iki/backend/message/ui_message_codec';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import {
  MODEL_OUTPUT_COMMITTED,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';

// The codec's one entry is the structured message the session log stores. The
// old storage round-trip (sanitize a JSON string, parse a JSON-string row) is
// deleted: both the UI list and the resume replay read ChatUiMessage objects
// out of the same session-log rebuild.

describe('normalizeUiMessage (structured storage shape)', () => {
  it('keeps reasoning parts across the stored shape', () => {
    const ui = normalizeUiMessage(
      {
        id: 'msg_reasoning',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'We need answer in Chinese first.', state: 'done' },
          { type: 'reasoning', text: 'Streaming reasoning must persist too.', state: 'streaming' },
          { type: 'text', text: 'Final answer.' },
        ],
      },
      { fallbackId: 'msg_reasoning' }
    );

    expect(ui?.parts).toEqual([
      { type: 'reasoning', text: 'We need answer in Chinese first.', state: 'done' },
      {
        type: 'reasoning',
        text: 'Streaming reasoning must persist too.',
        state: 'streaming',
      },
      { type: 'text', text: 'Final answer.' },
    ]);
  });

  it('preserves skill citation parts for persistence and reload', () => {
    const ui = normalizeUiMessage(
      {
        id: 'msg_1',
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
      },
      { fallbackId: 'msg_1' }
    );

    expect(ui?.parts).toEqual([
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
    const ui = normalizeUiMessage(
      { id: 'msg_legacy', role: 'user', content: 'hello from history' },
      { fallbackId: 'msg_legacy' }
    );

    expect(ui?.parts).toEqual([{ type: 'text', text: 'hello from history' }]);
  });

  it('gives tool parts the message-scoped fallback tool call id when none is carried', () => {
    const ui = normalizeUiMessage(
      {
        id: 'msg_tool',
        role: 'assistant',
        parts: [{ type: 'tool-call', toolName: 'read_file', input: { path: 'a.ts' } }],
      },
      { fallbackId: 'msg_tool' }
    );

    expect(ui?.parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolCallId: 'msg_tool_tool_0',
      toolName: 'read_file',
    });
  });

  it('drops non-object payloads instead of coercing them', () => {
    expect(normalizeUiMessage('a bare string', { fallbackId: 'x' })).toBeNull();
    expect(normalizeUiMessage(null, { fallbackId: 'x' })).toBeNull();
  });
});

describe('persistence ↔ session-log rebuild (one owner)', () => {
  let root = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-ui-codec-'));
    initializeDatabase({ dbPath: path.join(root, 'codec.db') });
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  // listMessages IS the rebuild — the pin that no second slicing rule exists.
  it('returns exactly the session-log rebuilt view', () => {
    const THREAD_ID = 'thread_codec_owner';
    const persistence = createChatPersistence({
      rebuildMessages: threadId => rebuildThreadViewFromEvents(threadId).messages,
    });

    const structured = persistence.createMessage({
      id: 'u1',
      thread_id: THREAD_ID,
      message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    });
    expect(structured).toMatchObject({ id: 'u1', role: 'user' });

    // The renderer's edit path may still hand over a JSON string; it lands as
    // structure — never re-stringified into a fake row.
    persistence.updateMessage('u1', {
      message: JSON.stringify({
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'edited' }],
      }),
    });

    const listed = persistence.listMessages(THREAD_ID);
    expect(listed).toEqual(rebuildThreadViewFromEvents(THREAD_ID).messages);
    expect(listed.map(message => message.id)).toEqual(['u1']);
    expect((listed[0]!.parts[0] as { text?: string }).text).toBe('edited');
  });

  it('refuses an assistant commit with no run stamp, and stores the run that wrote it', () => {
    const THREAD_ID = 'thread_codec_stamp';
    const persistence = createChatPersistence({
      rebuildMessages: threadId => rebuildThreadViewFromEvents(threadId).messages,
    });

    const assistant = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer', state: 'done' }],
    };
    expect(() =>
      persistence.updateMessage('a1', { thread_id: THREAD_ID, message: assistant })
    ).toThrow(/runId/);
    // ...and nothing was appended.
    expect(persistence.listMessages(THREAD_ID)).toEqual([]);

    persistence.updateMessage('a1', { thread_id: THREAD_ID, message: assistant, runId: 'run_x' });
    const [commit] = rebuildThreadViewFromEvents(THREAD_ID).events.filter(
      event => event.type === MODEL_OUTPUT_COMMITTED
    );
    expect((commit!.payload as { runId?: string }).runId).toBe('run_x');
    // Stored message stays structured — no JSON-string column anywhere.
    expect((commit!.payload as { message?: unknown }).message).toEqual(assistant);
  });
});
