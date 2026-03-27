export type ApprovalRecoveryContext = {
  sessionId: string;
  threadId: string;
  assistantMessageId: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  maxOutputTokens?: number;
  enabledTools: string[];
  availableSkillIds?: string[];
};
