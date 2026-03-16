import type { ActiveStreamState } from './chat_types';
import { createChatApproval } from './chat_approval';
import { createChatMemory } from './chat_memory';
import { createChatPersistence } from './chat_persistence';
import { createChatStreaming } from './chat_streaming';

export type { ChatWebContents } from './chat_types';

export const createChatService = () => {
  const activeStreams = new Map<number, ActiveStreamState>();

  const memory = createChatMemory();
  const approvals = createChatApproval({ activeStreams, memory });
  const persistence = createChatPersistence({ memory });
  const streaming = createChatStreaming({
    activeStreams,
    memory,
    approvals: {
      ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
      registerApprovalBatch: approvals.registerApprovalBatch,
    },
  });

  return {
    ...persistence,
    ...streaming,
    approveTool: approvals.approveTool,
  };
};

export type ChatService = ReturnType<typeof createChatService>;

export const chatService: ChatService = createChatService();

