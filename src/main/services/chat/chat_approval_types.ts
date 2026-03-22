export type ApprovalRecoveryContext = {
  sessionId: string;
  threadId: string;
  assistantMessageId: string;
  providerType: string;
  model: string;
  systemPrompt: string;
  maxOutputTokens?: number;
  enabledTools: string[];
  availableSkillIds?: string[];
};
