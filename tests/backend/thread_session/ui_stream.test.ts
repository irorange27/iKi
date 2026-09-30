import { describe, expect, it, vi } from 'vitest';

import { createUiChunkEmitter } from '@iki/backend/thread_session/ui_stream';

const target = { id: 1, send: vi.fn() };

describe('ui chunk emitter persistence reduction', () => {
  it('reduces text and tool chunks into the SDK message shape the renderer persists', async () => {
    const emitter = createUiChunkEmitter(target, 'assistant_1');
    emitter.emitTextDelta('Hello ');
    emitter.emitToolEvent({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'read_file',
      input: { path: 'a.ts' },
    });
    emitter.emitToolEvent({ type: 'tool-result', toolCallId: 'call_1', output: 'file body' });
    emitter.emitTextDelta('Done.');
    emitter.finish();

    const persisted = await emitter.buildPersistedMessage();
    expect(persisted?.id).toBe('assistant_1');
    expect(persisted?.role).toBe('assistant');

    const parts = persisted?.parts as Array<Record<string, unknown>>;
    const texts = parts.filter(part => part.type === 'text');
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ text: 'Hello ', state: 'done' });
    expect(texts[1]).toMatchObject({ text: 'Done.', state: 'done' });
    const tool = parts.find(part => part.type === 'dynamic-tool');
    expect(tool).toMatchObject({
      toolCallId: 'call_1',
      state: 'output-available',
      output: 'file body',
    });
  });

  it('keeps tool approval states from the SDK approval flow', async () => {
    const emitter = createUiChunkEmitter(target, 'assistant_2');
    emitter.emitToolEvent({
      type: 'tool-approval-request',
      approvalId: 'appr_1',
      toolCallId: 'call_2',
      toolCall: { toolName: 'shell', args: { command: 'ls' } },
    });
    emitter.finish();

    const persisted = await emitter.buildPersistedMessage();
    const parts = persisted?.parts as Array<Record<string, unknown>>;
    const tool = parts.find(part => part.type === 'dynamic-tool');
    expect(tool).toMatchObject({ toolCallId: 'call_2', state: 'approval-requested' });
  });

  it('seeds continuation reduction with the pre-pause parts', async () => {
    const emitter = createUiChunkEmitter(target, 'assistant_3');
    emitter.emitTextDelta('more');
    emitter.finish();

    const persisted = await emitter.buildPersistedMessage([
      { type: 'text', text: 'before pause', state: 'done' },
    ]);
    const parts = persisted?.parts as Array<Record<string, unknown>>;
    const texts = parts.filter(part => part.type === 'text');
    expect(texts.map(part => part.text)).toEqual(['before pause', 'more']);
  });

  it('returns null when the turn never started a message', async () => {
    const emitter = createUiChunkEmitter(target, 'assistant_4');
    expect(await emitter.buildPersistedMessage()).toBeNull();
  });
});
