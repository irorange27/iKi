import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addChatThreadMock,
  addChatMessageMock,
  countChatMessagesByThreadMock,
  deleteAwaitersByThreadMock,
  deleteChatThreadMock,
  getDbMock,
  getChatMessageMock,
  getChatThreadMock,
  listProactiveTaskIdsByThreadMock,
  updateProactiveTaskMock,
  updateChatThreadMock,
  touchChatThreadMock,
  onContinuityMessagePersistedMock,
  ensureThreadWorkspaceSelectionMock,
} = vi.hoisted(() => ({
  addChatThreadMock: vi.fn(),
  addChatMessageMock: vi.fn(),
  countChatMessagesByThreadMock: vi.fn(),
  deleteAwaitersByThreadMock: vi.fn(),
  deleteChatThreadMock: vi.fn(),
  getDbMock: vi.fn(() => ({
    transaction:
      <T extends unknown[], R>(fn: (...args: T) => R) =>
      (...args: T) =>
        fn(...args),
  })),
  getChatMessageMock: vi.fn(),
  getChatThreadMock: vi.fn(),
  listProactiveTaskIdsByThreadMock: vi.fn(),
  updateProactiveTaskMock: vi.fn(),
  updateChatThreadMock: vi.fn(),
  touchChatThreadMock: vi.fn(),
  onContinuityMessagePersistedMock: vi.fn(),
  ensureThreadWorkspaceSelectionMock: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  addChatMessage: addChatMessageMock,
  countChatMessagesByThread: countChatMessagesByThreadMock,
  getChatMessage: getChatMessageMock,
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  addChatThread: addChatThreadMock,
  deleteChatThread: deleteChatThreadMock,
  getChatThread: getChatThreadMock,
  updateChatThread: updateChatThreadMock,
  touchChatThread: touchChatThreadMock,
}));

vi.mock('@iki/backend/db/awaiters', () => ({
  deleteAwaitersByThread: deleteAwaitersByThreadMock,
}));

vi.mock('@iki/backend/db/tasks', () => ({
  listProactiveTaskIdsByThread: listProactiveTaskIdsByThreadMock,
  updateProactiveTask: updateProactiveTaskMock,
}));

vi.mock('@iki/backend/db/database', () => ({
  getDb: getDbMock,
}));

vi.mock('@iki/backend/chat_service/platform', () => ({
  onMessagePersisted: onContinuityMessagePersistedMock,
}));

vi.mock('@iki/backend/workspaces/thread_workspace', () => ({
  ensureThreadWorkspaceSelection: ensureThreadWorkspaceSelectionMock,
}));

vi.mock('@iki/backend/chat_service/ui_messages', () => ({
  sanitizeUiMessageJsonForStorage: vi.fn((value: string) => value),
}));

describe('chat_persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      title: 'New Chat',
      metadata: '{}',
      is_generating: false,
      is_favorited: 0,
      is_incognito: 1,
      workspace_id: 'workspace_alpha',
      enable_artifacts: 0,
    });
    getChatMessageMock.mockReturnValue({
      id: 'msg_1',
      thread_id: 'thread_1',
      message: JSON.stringify({ role: 'user', content: 'hello' }),
    });
    countChatMessagesByThreadMock.mockReturnValue(0);
    deleteAwaitersByThreadMock.mockReturnValue({ changes: 0 });
    deleteChatThreadMock.mockReturnValue({ changes: 1 });
    listProactiveTaskIdsByThreadMock.mockReturnValue([]);
    updateProactiveTaskMock.mockReturnValue({ changes: 1 });
    updateChatThreadMock.mockReturnValue({ changes: 1 });
  });

  it('persists thread creation fields that drive composer state and workspace scoping', async () => {
    const { createChatPersistence } = await import(
      '@iki/backend/chat_service/persistence'
    );

    const persistence = createChatPersistence({
      memory: {
        onMessagePersisted: vi.fn(),
      } as never,
    });

    const created = persistence.createThread({
      id: 'thread_1',
      title: 'Scoped thread',
      model: 'gpt-4.1',
      metadata: '{}',
      is_incognito: 1,
      workspace_id: 'workspace_alpha',
      tools: '["read_file"]',
      skill_ids: '["skill_alpha"]',
    });

    expect(addChatThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'thread_1',
        title: 'Scoped thread',
        model: 'gpt-4.1',
        metadata: '{}',
        is_incognito: 1,
        workspace_id: 'workspace_alpha',
        tools: '["read_file"]',
        skill_ids: '["skill_alpha"]',
      })
    );
    expect(ensureThreadWorkspaceSelectionMock).toHaveBeenCalledWith('thread_1');
    expect(getChatThreadMock).toHaveBeenCalledWith('thread_1');
    expect(created).toEqual(
      expect.objectContaining({
        id: 'thread_1',
        workspace_id: 'workspace_alpha',
        is_incognito: 1,
      })
    );
  });

  it('touches thread ordering and persists continuity when saving a chat message', async () => {
    const onMessagePersisted = vi.fn();
    const { createChatPersistence } = await import(
      '@iki/backend/chat_service/persistence'
    );

    const persistence = createChatPersistence({
      memory: {
        onMessagePersisted,
      } as never,
    });

    persistence.createMessage({
      id: 'msg_1',
      thread_id: 'thread_1',
      message: JSON.stringify({ role: 'user', content: 'hello' }),
      metadata: '{}',
    });

    expect(touchChatThreadMock).toHaveBeenCalledWith('thread_1');
    expect(onMessagePersisted).toHaveBeenCalled();
    expect(onContinuityMessagePersistedMock).toHaveBeenCalledWith({
      threadId: 'thread_1',
      messageId: 'msg_1',
      messageJson: JSON.stringify({
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      }),
    });
  });

  it('rejects workspace rebinding once a thread already has persisted messages', async () => {
    countChatMessagesByThreadMock.mockReturnValue(3);

    const { createChatPersistence } = await import(
      '@iki/backend/chat_service/persistence'
    );

    const persistence = createChatPersistence({
      memory: {
        onMessagePersisted: vi.fn(),
      } as never,
    });

    const result = persistence.updateThread('thread_1', {
      workspace_id: 'workspace_beta',
      title: 'Renamed thread',
    });

    expect(countChatMessagesByThreadMock).toHaveBeenCalledWith('thread_1');
    expect(updateChatThreadMock).toHaveBeenCalledWith('thread_1', {
      title: 'Renamed thread',
    });
    expect(result).toEqual({ changes: 1 });
  });

  it('clears a thread atomically while re-binding proactive tasks to the recreated thread id', async () => {
    const { createChatPersistence } = await import(
      '@iki/backend/chat_service/persistence'
    );

    getChatThreadMock
      .mockReturnValueOnce({
        id: 'thread_1',
        title: 'Old title',
        metadata: '{}',
        is_generating: false,
        is_favorited: 0,
        is_incognito: 1,
        workspace_id: 'workspace_alpha',
        enable_artifacts: 0,
      })
      .mockReturnValueOnce({
        id: 'thread_1',
        title: 'New Chat',
        metadata: '{}',
        is_generating: false,
        is_favorited: 0,
        is_incognito: 1,
        workspace_id: 'workspace_alpha',
        enable_artifacts: 0,
      });
    listProactiveTaskIdsByThreadMock.mockReturnValue(['task_1', 'task_2']);

    const persistence = createChatPersistence({
      memory: {
        onMessagePersisted: vi.fn(),
      } as never,
    });

    const cleared = persistence.clearThread('thread_1', {
      id: 'thread_1',
      title: 'New Chat',
      metadata: '{}',
      is_incognito: 1,
      workspace_id: 'workspace_alpha',
    });

    expect(deleteAwaitersByThreadMock).toHaveBeenCalledWith('thread_1');
    expect(listProactiveTaskIdsByThreadMock).toHaveBeenCalledWith('thread_1');
    expect(deleteChatThreadMock).toHaveBeenCalledWith('thread_1');
    expect(addChatThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'thread_1',
        title: 'New Chat',
        is_incognito: 1,
        workspace_id: 'workspace_alpha',
      })
    );
    expect(updateProactiveTaskMock).toHaveBeenNthCalledWith(1, 'task_1', {
      thread_id: 'thread_1',
    });
    expect(updateProactiveTaskMock).toHaveBeenNthCalledWith(2, 'task_2', {
      thread_id: 'thread_1',
    });
    expect(cleared).toEqual(
      expect.objectContaining({
        id: 'thread_1',
        title: 'New Chat',
      })
    );
  });
});
