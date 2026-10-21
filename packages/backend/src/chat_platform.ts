/* eslint-disable @typescript-eslint/no-empty-function -- default no-op bridge */
import type { ConversationPreview } from './types/companion';

export interface ChatCompanionBridge {
  beginThinking(key: string): void;
  endThinking(key: string): void;
  setConversationPreview(preview: ConversationPreview): void;
  clearConversationPreview(): void;
  notifyReplyComplete(threadLabel?: string): void;
}

export interface ChatServicePlatformDeps {
  companion?: ChatCompanionBridge;
  exportTrace?: (runId: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  exportThreadMarkdown?: (params: { threadId: string; title: string; content: string }) => Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
  }>;
  getAutoPinnedSkillIds?: (threadId: string) => string[];
  recordAutoSkillSelection?: (params: {
    threadId: string;
    availableSkillIds: string[];
    selectedSkillIds: string[];
    timestamp?: string;
  }) => void;
}

export const noopCompanionBridge: ChatCompanionBridge = {
  beginThinking: () => {},
  endThinking: () => {},
  setConversationPreview: () => {},
  clearConversationPreview: () => {},
  notifyReplyComplete: () => {},
};

export const noopPlatformDeps: ChatServicePlatformDeps = {
  companion: noopCompanionBridge,
};
