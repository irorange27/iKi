// @vitest-environment happy-dom
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
      generateId: () => 'assistant_1',
      getCurrentThreadId: () => 'thread_1',
    });

    void instance.chat.sendMessage({
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'write a file' }],
    });
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
    expect(toolCallIds).toContain('call_2');
  });

  it('cannot lose the pre-pause parts when the backend re-seed is absent (issue #71 is closed by construction)', async () => {
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
    api.emit({ type: 'start', messageId: 'assistant_1' });
    api.emit({ type: 'tool-output-available', toolCallId: 'call_1', output: 'written' });
    api.emit({ type: 'finish' });
    await approvalPromise;
    await flush();

    expect(instance.error.value?.message).toBeUndefined();
    expect(instance.status.value).not.toBe('error');

    expect(instance.messageStore.messages.flatMap(m => m.parts ?? [])).toHaveLength(1);
  });});

