import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addChatThreadMock,
  addChatMessageMock,
  getChatMessageMock,
  getChatThreadMock,
  touchChatThreadMock,
  touchThreadRelationshipStateMock,
  ensureThreadWorkspaceSelectionMock,
} = vi.hoisted(() => ({
  addChatThreadMock: vi.fn(),
  addChatMessageMock: vi.fn(),
  getChatMessageMock: vi.fn(),
  getChatThreadMock: vi.fn(),
  touchChatThreadMock: vi.fn(),
  touchThreadRelationshipStateMock: vi.fn(),
  ensureThreadWorkspaceSelectionMock: vi.fn(),
}));

vi.mock('../../../../src/core/db/chat_message', () => ({
  addChatMessage: addChatMessageMock,
  getChatMessage: getChatMessageMock,
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  addChatThread: addChatThreadMock,
  getChatThread: getChatThreadMock,
  touchChatThread: touchChatThreadMock,
}));

vi.mock('../../../../src/main/services/relationship/relationship_service', () => ({
  touchThreadRelationshipState: touchThreadRelationshipStateMock,
}));

vi.mock('../../../../src/core/workspaces/thread_workspace', () => ({
  ensureThreadWorkspaceSelection: ensureThreadWorkspaceSelectionMock,
}));

vi.mock('../../../../src/main/services/chat/chat_ui', () => ({
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
  });

  it('persists thread creation fields that drive composer state and workspace scoping', async () => {
    const { createChatPersistence } = await import(
      '../../../../src/main/services/chat/chat_persistence'
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

  it('touches thread relationship state when persisting a chat message', async () => {
    const onMessagePersisted = vi.fn();
    const { createChatPersistence } = await import(
      '../../../../src/main/services/chat/chat_persistence'
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
    expect(touchThreadRelationshipStateMock).toHaveBeenCalledWith(
      'thread_1',
      expect.any(String)
    );
    expect(onMessagePersisted).toHaveBeenCalled();
  });
});
