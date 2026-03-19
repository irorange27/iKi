export type ApprovalRecoveryContext = {
  sessionId: string;
  threadId: string;
  assistantMessageId: string;
  providerType: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
};
