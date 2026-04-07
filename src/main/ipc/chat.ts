import { ipcMain } from 'electron';

import { chatService, type ChatWebContents } from '../services/chat/chat_service';

let chatIpcRegistered = false;

const toChatWebContents = (sender: Pick<ChatWebContents, 'id' | 'send'>): ChatWebContents => sender;

export const registerChatIpc = (): void => {
  if (chatIpcRegistered) return;
  chatIpcRegistered = true;

  // Chat Thread Management
  ipcMain.handle('chat:threads:list', () => chatService.listThreads());
  ipcMain.handle('chat:threads:get', (_, id) => chatService.getThread(id));
  ipcMain.handle('chat:threads:todo:get', (_, threadId) => chatService.getThreadTodoPlan(threadId));
  ipcMain.handle('chat:threads:create', (_, thread) => chatService.createThread(thread));
  ipcMain.handle('chat:threads:update', (_, id, thread) => chatService.updateThread(id, thread));
  ipcMain.handle('chat:threads:delete', (_, id) => chatService.deleteThread(id));

  // Chat Message Management
  ipcMain.handle('chat:messages:list', (_, threadId) => chatService.listMessages(threadId));
  ipcMain.handle('chat:messages:get', (_, id) => chatService.getMessage(id));
  ipcMain.handle('chat:messages:create', (_, message) => chatService.createMessage(message));
  ipcMain.handle('chat:messages:update', (_, id, message) =>
    chatService.updateMessage(id, message)
  );
  ipcMain.handle('chat:messages:delete', (_, id) => chatService.deleteMessage(id));

  // Chat/LLM Integration
  ipcMain.handle('chat:getModels', async (_, providerType: string, providerId?: string) => {
    return await chatService.getModels(providerType, providerId);
  });

  ipcMain.handle('chat:isProviderConfigured', (_, providerType: string, providerId?: string) => {
    return chatService.isProviderConfigured(providerType, providerId);
  });

  ipcMain.handle('chat:stop-stream', event => {
    return chatService.stopStream(event.sender.id);
  });

  ipcMain.handle('chat:send', async (_, options) => {
    return await chatService.send(options);
  });

  ipcMain.handle('chat:stream', async (event, options) => {
    const webContents = toChatWebContents(event.sender);
    return await chatService.stream(webContents, options);
  });

  ipcMain.handle('chat:approve-tool', async (event, approvalId: string, approved: boolean) => {
    const webContents = toChatWebContents(event.sender);
    return await chatService.approveTool(webContents, approvalId, approved);
  });

  ipcMain.handle('chat:usage:summary', (_, period) => {
    return chatService.getUsageSummary(period);
  });
};
