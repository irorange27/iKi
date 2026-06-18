import type { UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatMessageStore } from '../../packages/desktop/src/renderer/modules/chat/chat_message_store';
import { createChatUiStreamController } from '../../packages/desktop/src/renderer/modules/chat/ui_stream_controller';
import { resetToolUiStateMap } from '../../packages/desktop/src/renderer/modules/chat/tool_ui_state';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createController = (params?: { currentThreadId?: string; initialMessages?: UIMessage[] }) => {
  const threadRef = {
    value: params?.currentThreadId || 'thread_1',
  };
  const messages = [...(params?.initialMessages || [])];
  const messageStore = createChatMessageStore({ messages });
  const stopStream = vi.fn(async () => ({ success: true }));
  const approveTool = vi.fn(async () => ({ success: true }));
  const persistence = {
    upsertUiMessage: vi.fn(async () => undefined),
  };
  const createMessageId = vi.fn(() => `msg_${messages.length + 1}`);
  const scrollToBottom = vi.fn();

  const controller = createChatUiStreamController({
    messageStore,
    electronAPI: {
      chat: {
        stopStream,
        approveTool,
      },
    },
    persistence: persistence as never,
    createMessageId,
    scrollToBottom,
    getCurrentThreadId: () => threadRef.value,
  });

  return {
    threadRef,
    messageStore,
    stopStream,
    approveTool,
    persistence,
    createMessageId,
    scrollToBottom,
    controller,
  };
};

beforeEach(() => {
  resetToolUiStateMap();
  vi.clearAllMocks();
});

describe('createChatUiStreamController', () => {
  it('ignores stream chunks when active stream is bound to a different thread', async () => {
    const { controller, messageStore } = createController({ currentThreadId: 'thread_A' });

    controller.beginTurn({ threadId: 'thread_B', parentId: 'user_1' });
    await flushMicrotasks();
    await controller.handleUiChunk({ type: 'text-delta', delta: 'hello from stream' });

    expect(controller.isStreamBoundToCurrentThread()).toBe(false);
    expect(messageStore.messages).toHaveLength(0);
  });

  it('re-binds approval flow to current thread and persists approval response updates', async () => {
    const userMessage: UIMessage = {
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'run tool' }],
    };
    const assistantMessage: UIMessage = {
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'web',
          toolCallId: 'tool_1',
          state: 'approval-requested',
          input: { query: 'hello' },
          approval: { id: 'approval_1' },
        },
      ],
    };

    const { controller, approveTool, persistence, messageStore } = createController({
      currentThreadId: 'thread_1',
      initialMessages: [userMessage, assistantMessage],
    });

    await controller.handleToolApproval(assistantMessage, assistantMessage.parts[0], true);

    expect(approveTool).toHaveBeenCalledWith('approval_1', true);
    expect(persistence.upsertUiMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread_1',
        parentId: 'user_1',
        source: 'tool-approval:approve',
      })
    );

    const updated = messageStore.getById('assistant_1');
    expect(updated?.parts[0]).toMatchObject({
      type: 'dynamic-tool',
      state: 'approval-responded',
      approval: {
        id: 'approval_1',
        approved: true,
      },
    });
    expect(controller.isApprovalProcessing(updated?.parts[0])).toBe(false);
  });
});
