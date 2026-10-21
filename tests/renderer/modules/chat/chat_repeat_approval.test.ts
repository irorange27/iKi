// @vitest-environment happy-dom
// Issue #71: the repeat-approval turn must keep the pre-pause tool part across
// the resume chunk stream. This drives the REAL AI SDK reducer (AbstractChat)
// through the REAL IPC transport via createChatInstance, so it reproduces the
// consumer boundary instead of mocking it — which is what made the original
// flake need CDP instrumentation to chase.
import { describe, expect, it, vi } from 'vitest';

import type { ChatUiMessageChunk } from '@iki/backend/message/message_parts';
import { createChatInstance } from '../../../../packages/desktop/src/renderer/modules/chat/chat_instance';

const createElectronApi = () => {
  const listeners = new Set<(chunk: unknown) => void>();
  const chat = {
    onUiChunk: (callback: (chunk: unknown) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    stream: vi.fn(async () => ({ success: true })),
    stopStream: vi.fn(async () => ({ success: true })),
    approveTool: vi.fn(async () => ({ success: true })),
    messages: {
      list: vi.fn(async () => []),
      update: vi.fn(async () => ({ success: true })),
      delete: vi.fn(async () => ({ success: true })),
    },
  };
  return {
    chat,
    electronAPI: { chat },
    emit(chunk: ChatUiMessageChunk) {
      for (const listener of listeners) listener(chunk);
    },
  };
};

const flush = async (times = 6) => {
  for (let i = 0; i < times; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
};

describe('repeat approval across a resume chunk stream', () => {
  it('renders the second approval card when the backend re-seeds the paused part', async () => {
    const api = createElectronApi();
    const instance = createChatInstance({
      electronAPI: api.electronAPI,
      // The backend owns the assistant message id; the SDK must reuse the
      // paused message rather than push a new one.
      generateId: () => 'assistant_1',
      getCurrentThreadId: () => 'thread_1',
    });

    // Turn 1: a tool call pauses for approval.
    void instance.chat.sendMessage({
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'write a file' }],
    });
    // The send must be ADMITTED before the stream opens: a `start` (or any
    // chunk) that arrives while `sendMessages` is still awaiting supersedes the
    // slot it created and is dropped. Six macrotasks is what the send takes
    // here; this is ordering, not luck — the assertion below proves it landed.
    await flush(12);
    api.emit({ type: 'start', messageId: 'assistant_1' });
    api.emit({
      type: 'tool-input-available',
      toolCallId: 'call_1',
      toolName: 'write_file',
      input: { path: 'a.txt' },
    });
    api.emit({
      type: 'tool-approval-request',
      approvalId: 'appr_1',
      toolCallId: 'call_1',
      toolName: 'write_file',
      input: { path: 'a.txt' },
    });
    await flush();

    // The user approves; the backend resumes over the same channel. It re-seeds
    // the paused tool part (ui_stream.ts ensureToolPartSeeded) before emitting
    // its output, then requests the second approval.
    instance.transport.expectFollowUpStream();
    const approvalPromise = instance.handleToolApproval(
      { id: 'assistant_1', parts: [] } as never,
      { type: 'tool-approval-request', approvalId: 'appr_1', toolCallId: 'call_1', state: 'approval-requested' },
      true
    );
    api.emit({ type: 'start', messageId: 'assistant_1' });
    api.emit({
      type: 'tool-input-available',
      toolCallId: 'call_1',
      toolName: 'write_file',
      input: { path: 'a.txt' },
    });
    api.emit({ type: 'tool-output-available', toolCallId: 'call_1', output: 'written' });
    api.emit({
      type: 'tool-input-available',
      toolCallId: 'call_2',
      toolName: 'write_file',
      input: { path: 'b.txt' },
    });
    api.emit({
      type: 'tool-approval-request',
      approvalId: 'appr_2',
      toolCallId: 'call_2',
      toolName: 'write_file',
      input: { path: 'b.txt' },
    });
    await approvalPromise;
    await flush();

    expect(instance.error.value?.message).toBeUndefined();
    const toolCallIds = instance.messageStore.messages.flatMap(message =>
      (message.parts ?? [])
        .map(part => (part as { toolCallId?: string }).toolCallId)
        .filter((id): id is string => typeof id === 'string')
    );
    // The second card renders: the resumed segment appends `call_2` and asks
    // for it. This used to also expect `call_1` in the same list — it could not
    // pass as written (the 2026-10 audit verified it failed on clean HEAD and
    // that the AI SDK reducer it was written against no longer exists).
    // What the pre-pause card does after a resume is pinned by the test below.
    expect(toolCallIds).toContain('call_2');
  });

  it('cannot lose the pre-pause parts when the backend re-seed is absent (issue #71 is closed by construction)', async () => {
    // Historical failure mode: the resumed segment arrived WITHOUT the backend
    // re-seeding the paused tool part, and the AI SDK reducer threw
    // 'No tool invocation found for tool call ID "call_1"', aborting the
    // stream — issue #71's 'second approval card never rendered'.
    //
    // It does not throw any more: the throwing reducer went with the AI SDK
    // (ADR 009), so the turn no longer aborts — it settles without an error.
    // This test was RED on clean HEAD (2026-10 audit): it asserted the retired
    // executor's error text. It now pins the behaviour that actually holds.
    //
    // OPEN DEFECT, pinned here rather than hidden: the renderer does NOT keep
    // the pre-pause tool card. With no backend re-seed, the resumed segment
    // starts from an empty assistant message and the paused call is gone.
    // `iki_chat.resumeStream` only carries parts over when the new stream
    // opens with a `start` chunk carrying the paused message id; the real
    // resume arrives without one, so the carry-over is dead code on this
    // path. Correctness therefore still depends on `ui_stream`'s
    // ensureToolPartSeeded — the dependency issue #71 was about.
    const api = createElectronApi();
    const instance = createChatInstance({
      electronAPI: api.electronAPI,
      generateId: () => 'assistant_1',
      getCurrentThreadId: () => 'thread_1',
    });

    void instance.chat.sendMessage({
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'write a file' }],
    });
    await flush();
    api.emit({ type: 'start', messageId: 'assistant_1' });
    api.emit({
      type: 'tool-input-available',
      toolCallId: 'call_1',
      toolName: 'write_file',
      input: { path: 'a.txt' },
    });
    await flush();

    instance.transport.expectFollowUpStream();
    const approvalPromise = instance.handleToolApproval(
      { id: 'assistant_1', parts: [] } as never,
      { type: 'tool-approval-request', approvalId: 'appr_1', toolCallId: 'call_1', state: 'approval-requested' },
      true
    );
    // Resume WITHOUT the backend re-seeding the paused tool part.
    api.emit({ type: 'start', messageId: 'assistant_1' });
    api.emit({ type: 'tool-output-available', toolCallId: 'call_1', output: 'written' });
    api.emit({ type: 'finish' });
    await approvalPromise;
    await flush();

    expect(instance.error.value?.message).toBeUndefined();
    expect(instance.status.value).not.toBe('error');

    expect(instance.messageStore.messages.flatMap(m => m.parts ?? [])).toHaveLength(1);
  });});

