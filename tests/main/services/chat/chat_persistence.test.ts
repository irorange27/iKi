import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addChatMessageMock,
  getChatMessageMock,
  touchChatThreadMock,
  touchThreadRelationshipStateMock,
} = vi.hoisted(() => ({
  addChatMessageMock: vi.fn(),
  getChatMessageMock: vi.fn(),
  touchChatThreadMock: vi.fn(),
  touchThreadRelationshipStateMock: vi.fn(),
}));

vi.mock('../../../../src/core/db/chat_message', () => ({
  addChatMessage: addChatMessageMock,
  getChatMessage: getChatMessageMock,
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  touchChatThread: touchChatThreadMock,
}));

vi.mock('../../../../src/main/services/relationship/relationship_service', () => ({
  touchThreadRelationshipState: touchThreadRelationshipStateMock,
}));

describe('chat_persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChatMessageMock.mockReturnValue({
      id: 'msg_1',
      thread_id: 'thread_1',
      message: JSON.stringify({ role: 'user', content: 'hello' }),
    });
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
