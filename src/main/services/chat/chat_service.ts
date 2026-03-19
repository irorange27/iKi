import type { ActiveStreamState } from './chat_types';
import { createChatApproval } from './chat_approval';
import { createChatMemory } from './chat_memory';
import { createChatPersistence } from './chat_persistence';
import { createChatStreaming } from './chat_streaming';
import { createChatUsage } from './chat_usage';

export type { ChatWebContents } from './chat_types';

export const createChatService = () => {
  const activeStreams = new Map<number, ActiveStreamState>();

  const memory = createChatMemory();
  const usage = createChatUsage();
  const approvals = createChatApproval({
    activeStreams,
    memory,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
  });
  const persistence = createChatPersistence({ memory });
  const streaming = createChatStreaming({
    activeStreams,
    memory,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
    approvals: {
      ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
      registerApprovalBatch: approvals.registerApprovalBatch,
    },
  });

  return {
    ...persistence,
    ...streaming,
    getUsageSummary: usage.getUsageSummary,
    approveTool: approvals.approveTool,
  };
};

export type ChatService = ReturnType<typeof createChatService>;

export const chatService: ChatService = createChatService();
