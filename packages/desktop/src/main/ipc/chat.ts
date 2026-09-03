import { ipcMain } from 'electron';

import { toPlainData } from '@iki/backend/utils/plain_clone';
import { chatService, type ChatStreamTarget } from '../services/chat/service';

let chatIpcRegistered = false;

const toChatStreamTarget = (sender: Pick<ChatStreamTarget, 'id' | 'send'>): ChatStreamTarget => sender;

export const registerChatIpc = (): void => {
  if (chatIpcRegistered) return;
  chatIpcRegistered = true;

  // Chat Thread Management
  ipcMain.handle('chat:threads:list', () => chatService.listThreads());
  ipcMain.handle('chat:threads:get', (_, id) => chatService.getThread(id));
  ipcMain.handle('chat:threads:todo:get', (_, threadId) => chatService.getThreadTodoPlan(threadId));
  ipcMain.handle('chat:threads:create', (_, thread) => chatService.createThread(thread));
  ipcMain.handle('chat:threads:clear', (_, id, thread) => chatService.clearThread(id, thread));
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
  ipcMain.handle('chat:runs:list', (_, threadId: string) =>
    toPlainData(chatService.listRuns(threadId))
  );
  ipcMain.handle('chat:runs:trace:get', (_, runId: string) =>
    toPlainData(chatService.getRunTrace(runId))
  );
  ipcMain.handle('chat:runs:tree:get', (_, rootRunId: string) =>
    toPlainData(chatService.getRunTree(rootRunId))
  );
  ipcMain.handle('chat:runs:list-by-status', (_, statuses: string[], opts?: { clientId?: string; limit?: number }) =>
    toPlainData(chatService.listRunsByStatus(statuses as import('@iki/backend/types/agent_run').AgentRunStatus[], opts))
  );
  ipcMain.handle('chat:runs:cancel', (_, runId: string) =>
    chatService.cancelRun(runId)
  );
  ipcMain.handle('chat:runs:retry', (_, runId: string) =>
    chatService.retryRun(runId)
  );
  ipcMain.handle('chat:runs:retry-and-execute', async (event, runId: string) => {
    const target = toChatStreamTarget(event.sender);
    return await chatService.retryAndExecute(target, runId);
  });
  ipcMain.handle('chat:runs:resume', async (event, runId: string) => {
    const target = toChatStreamTarget(event.sender);
    return await chatService.resumeRun(target, runId);
  });

  // Chat/LLM Integration
  ipcMain.handle(
    'chat:getModels',
    async (
      _,
      providerType: string,
      providerId?: string,
      providerOverride?: Record<string, unknown> | null
    ) => {
      return await chatService.getModels(providerType, providerId, providerOverride ?? null);
    }
  );

  ipcMain.handle('chat:isProviderConfigured', (_, providerType: string, providerId?: string) => {
    return chatService.isProviderConfigured(providerType, providerId);
  });

  ipcMain.handle(
    'chat:acp:auth-methods',
    async (
      _,
      providerType: string,
      providerId?: string,
      providerOverride?: Record<string, unknown> | null
    ) => {
      return await chatService.getAcpAuthMethods(providerType, providerId, providerOverride ?? null);
    }
  );

  ipcMain.handle('chat:stop-stream', event => {
    return chatService.stopStream(event.sender.id);
  });

  ipcMain.handle('chat:steer-stream', (event, threadId: string | undefined, message: string) => {
    return chatService.steerStream(event.sender.id, threadId, message);
  });

  ipcMain.handle('chat:send', async (_, options) => {
    return await chatService.send(options);
  });

  ipcMain.handle('chat:stream', async (event, options) => {
    const target = toChatStreamTarget(event.sender);
    return await chatService.stream(target, options);
  });

  ipcMain.handle('chat:approve-tool', async (event, approvalId: string, approved: boolean) => {
    const target = toChatStreamTarget(event.sender);
    return await chatService.approveTool(target, approvalId, approved);
  });

  // Agent Evaluation
  ipcMain.handle('chat:eval:export-trace', async (_, runId: string) => {
    return chatService.eval.exportTrace(runId);
  });
  ipcMain.handle('chat:eval:add-label', (_, input) => {
    return chatService.eval.addLabel(input);
  });
  ipcMain.handle('chat:eval:list-labels', (_, runId: string) => {
    return chatService.eval.listLabels(runId);
  });
  ipcMain.handle('chat:eval:delete-label', (_, labelId: string) => {
    return chatService.eval.deleteLabel(labelId);
  });
  ipcMain.handle('chat:eval:compare-runs', (_, baselineRunId: string, testRunId: string) => {
    return chatService.eval.compareRuns(baselineRunId, testRunId);
  });
  ipcMain.handle('chat:eval:assess-regression', (_, baselineRunId: string, testRunId: string) => {
    return chatService.eval.assessRegression(baselineRunId, testRunId);
  });

  ipcMain.handle('chat:usage:summary', (_, period) => {
    return chatService.getUsageSummary(period);
  });
};
