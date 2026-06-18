import type { CompanionAffectHint, ConversationPreview } from './types/companion';
import type { InterventionPolicySignal } from './chat/intervention_policy';

export interface ChatCompanionBridge {
  beginThinking(key: string): void;
  endThinking(key: string): void;
  setConversationPreview(preview: ConversationPreview): void;
  clearConversationPreview(): void;
  setChatPolicy(policy: InterventionPolicySignal): void;
  setAffect(hint: CompanionAffectHint | null): void;
  notifyReplyComplete(threadLabel?: string): void;
}

export interface ContinuityMemoryPreview {
  id: string;
  summary: string;
  score: number;
  updated_at?: string;
  tags?: string[];
  sourceMessageCount?: number;
}

export interface ContinuityRetrievalPayload {
  query: string;
  results: ContinuityMemoryPreview[];
  systemMessage: string;
}

export interface ChatServicePlatformDeps {
  companion?: ChatCompanionBridge;
  exportTrace?: (runId: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  getClipboardContextMessage?: (maxEntries: number) => string | undefined;
  getAssistantProfileContextMessage?: () => string;
  retrieveRelevantContinuity?: (query: string) => ContinuityRetrievalPayload | null;
  onMessagePersisted?: (params: { threadId: string; messageId: string; messageJson: string }) => Promise<void>;
  getAutoPinnedSkillIds?: (threadId: string) => string[];
  recordAutoSkillSelection?: (params: { threadId: string; availableSkillIds: string[]; selectedSkillIds: string[]; timestamp?: string }) => void;
}

export const noopCompanionBridge: ChatCompanionBridge = {
  beginThinking: () => {},
  endThinking: () => {},
  setConversationPreview: () => {},
  clearConversationPreview: () => {},
  setChatPolicy: () => {},
  setAffect: () => {},
  notifyReplyComplete: () => {},
};

export const noopPlatformDeps: ChatServicePlatformDeps = {
  companion: noopCompanionBridge,
};
