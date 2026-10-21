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
    await flush();
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
    expect(toolCallIds).toContain('call_1');
    expect(toolCallIds).toContain('call_2');
  });

  it('aborts the stream when the pre-pause seed is lost (the issue signature)', async () => {
    // The renderer is NOT timing-proof on its own: correctness depends on the
    // backend re-seed arriving. Drive the REAL approval flow without the
    // re-seed and the AI SDK reducer throws, aborting the stream — which is
    // exactly issue #71's 'second approval card never rendered'. This must
    // go through handleToolApproval (which calls resumeStream), because
    // emitting onto the transport alone never hands the buffered resume slot
    // to the Chat and the reducer never runs.
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

    expect(instance.error.value?.message).toContain(
      'No tool invocation found for tool call ID "call_1"'
    );
    expect(instance.status.value).toBe('error');
  });});
