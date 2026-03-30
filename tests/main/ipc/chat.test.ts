import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { ipcHandlers, ipcHandleMock, chatServiceMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  ipcHandleMock: vi.fn((channel: string, handler: IpcHandler) => {
    ipcHandlers.set(channel, handler);
  }),
  chatServiceMock: {
    listThreads: vi.fn(() => [{ id: 'thread_1' }]),
    getThread: vi.fn((id: string) => ({ id })),
    getThreadTodoPlan: vi.fn((threadId: string) => ({ thread_id: threadId, items: [] })),
    createThread: vi.fn((thread: Record<string, unknown>) => ({ id: 'thread_new', ...thread })),
    updateThread: vi.fn((id: string, thread: Record<string, unknown>) => ({ id, ...thread })),
    deleteThread: vi.fn((id: string) => ({ success: true, id })),
    listMessages: vi.fn((threadId: string) => [{ id: 'message_1', thread_id: threadId }]),
    getMessage: vi.fn((id: string) => ({ id })),
    createMessage: vi.fn((message: Record<string, unknown>) => ({ id: 'message_new', ...message })),
    updateMessage: vi.fn((id: string, message: Record<string, unknown>) => ({ id, ...message })),
    deleteMessage: vi.fn((id: string) => ({ success: true, id })),
    getModels: vi.fn(async (providerType: string) => [`${providerType}-model`]),
    isProviderConfigured: vi.fn((providerType: string) => providerType === 'openai'),
    stopStream: vi.fn((senderId: number) => ({ success: true, senderId })),
    send: vi.fn(async (options: Record<string, unknown>) => ({ success: true, options })),
    stream: vi.fn(async (webContents: unknown, options: Record<string, unknown>) => ({
      success: true,
      webContents,
      options,
    })),
    approveTool: vi.fn(async (webContents: unknown, approvalId: string, approved: boolean) => ({
      success: true,
      webContents,
      approvalId,
      approved,
    })),
    getUsageSummary: vi.fn((period: string) => ({ period, totalTokens: 42 })),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

vi.mock('../../../src/main/services/chat/chat_service', () => ({
  chatService: chatServiceMock,
}));

describe('chat IPC', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers the chat IPC surface once and keeps duplicate registration idempotent', async () => {
    const { registerChatIpc } = await import('../../../src/main/ipc/chat');

    registerChatIpc();

    expect([...ipcHandlers.keys()]).toEqual([
      'chat:threads:list',
      'chat:threads:get',
      'chat:threads:todo:get',
      'chat:threads:create',
      'chat:threads:update',
      'chat:threads:delete',
      'chat:messages:list',
      'chat:messages:get',
      'chat:messages:create',
      'chat:messages:update',
      'chat:messages:delete',
      'chat:getModels',
      'chat:isProviderConfigured',
      'chat:stop-stream',
      'chat:send',
      'chat:stream',
      'chat:approve-tool',
      'chat:usage:summary',
    ]);

    const registeredCount = ipcHandleMock.mock.calls.length;
    registerChatIpc();

    expect(ipcHandleMock).toHaveBeenCalledTimes(registeredCount);
  });

  it('routes every chat handler through the shared chat service with the correct sender context', async () => {
    const { registerChatIpc } = await import('../../../src/main/ipc/chat');
    registerChatIpc();

    const sender = { id: 77, send: vi.fn() };
    const event = { sender };
    const threadPayload = { title: 'Thread' };
    const messagePayload = { thread_id: 'thread_1', message: '{}' };
    const sendPayload = { providerType: 'openai', model: 'gpt-4.1', messages: [] };
    const streamPayload = { providerType: 'openai', model: 'gpt-4.1', messages: [], tools: ['web'] };

    expect(await ipcHandlers.get('chat:threads:list')?.(null)).toEqual([{ id: 'thread_1' }]);
    expect(await ipcHandlers.get('chat:threads:get')?.(null, 'thread_1')).toEqual({ id: 'thread_1' });
    expect(await ipcHandlers.get('chat:threads:todo:get')?.(null, 'thread_1')).toEqual({
      thread_id: 'thread_1',
      items: [],
    });
    expect(await ipcHandlers.get('chat:threads:create')?.(null, threadPayload)).toEqual({
      id: 'thread_new',
      title: 'Thread',
    });
    expect(await ipcHandlers.get('chat:threads:update')?.(null, 'thread_1', threadPayload)).toEqual({
      id: 'thread_1',
      title: 'Thread',
    });
    expect(await ipcHandlers.get('chat:threads:delete')?.(null, 'thread_1')).toEqual({
      success: true,
      id: 'thread_1',
    });

    expect(await ipcHandlers.get('chat:messages:list')?.(null, 'thread_1')).toEqual([
      { id: 'message_1', thread_id: 'thread_1' },
    ]);
    expect(await ipcHandlers.get('chat:messages:get')?.(null, 'message_1')).toEqual({
      id: 'message_1',
    });
    expect(await ipcHandlers.get('chat:messages:create')?.(null, messagePayload)).toEqual({
      id: 'message_new',
      thread_id: 'thread_1',
      message: '{}',
    });
    expect(await ipcHandlers.get('chat:messages:update')?.(null, 'message_1', messagePayload)).toEqual({
      id: 'message_1',
      thread_id: 'thread_1',
      message: '{}',
    });
    expect(await ipcHandlers.get('chat:messages:delete')?.(null, 'message_1')).toEqual({
      success: true,
      id: 'message_1',
    });

    expect(await ipcHandlers.get('chat:getModels')?.(null, 'openai')).toEqual(['openai-model']);
    expect(await ipcHandlers.get('chat:isProviderConfigured')?.(null, 'openai')).toBe(true);
    expect(await ipcHandlers.get('chat:stop-stream')?.(event)).toEqual({ success: true, senderId: 77 });
    expect(await ipcHandlers.get('chat:send')?.(null, sendPayload)).toEqual({
      success: true,
      options: sendPayload,
    });
    expect(await ipcHandlers.get('chat:stream')?.(event, streamPayload)).toEqual({
      success: true,
      webContents: sender,
      options: streamPayload,
    });
    expect(await ipcHandlers.get('chat:approve-tool')?.(event, 'approval_1', true)).toEqual({
      success: true,
      webContents: sender,
      approvalId: 'approval_1',
      approved: true,
    });
    expect(await ipcHandlers.get('chat:usage:summary')?.(null, '30d')).toEqual({
      period: '30d',
      totalTokens: 42,
    });

    expect(chatServiceMock.listThreads).toHaveBeenCalledTimes(1);
    expect(chatServiceMock.getThread).toHaveBeenCalledWith('thread_1');
    expect(chatServiceMock.getThreadTodoPlan).toHaveBeenCalledWith('thread_1');
    expect(chatServiceMock.createThread).toHaveBeenCalledWith(threadPayload);
    expect(chatServiceMock.updateThread).toHaveBeenCalledWith('thread_1', threadPayload);
    expect(chatServiceMock.deleteThread).toHaveBeenCalledWith('thread_1');
    expect(chatServiceMock.listMessages).toHaveBeenCalledWith('thread_1');
    expect(chatServiceMock.getMessage).toHaveBeenCalledWith('message_1');
    expect(chatServiceMock.createMessage).toHaveBeenCalledWith(messagePayload);
    expect(chatServiceMock.updateMessage).toHaveBeenCalledWith('message_1', messagePayload);
    expect(chatServiceMock.deleteMessage).toHaveBeenCalledWith('message_1');
    expect(chatServiceMock.getModels).toHaveBeenCalledWith('openai');
    expect(chatServiceMock.isProviderConfigured).toHaveBeenCalledWith('openai', undefined);
    expect(chatServiceMock.stopStream).toHaveBeenCalledWith(77);
    expect(chatServiceMock.send).toHaveBeenCalledWith(sendPayload);
    expect(chatServiceMock.stream).toHaveBeenCalledWith(sender, streamPayload);
    expect(chatServiceMock.approveTool).toHaveBeenCalledWith(sender, 'approval_1', true);
    expect(chatServiceMock.getUsageSummary).toHaveBeenCalledWith('30d');
  });
});
