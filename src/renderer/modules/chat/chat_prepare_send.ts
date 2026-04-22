import type { ChatUiMessage, ComposerInvocationPartData } from '../../../shared/chat/message_parts';

export type PrepareMessageSendPayload = {
  content: string;
  model?: string;
  providerId?: string;
  tools?: string[];
  mcpServerIds?: string[];
  promptAppId?: string;
  composerInvocations?: ComposerInvocationPartData;
};

export type PreparedMessageSend = {
  threadId: string;
  messagesSnapshot: ChatUiMessage[];
};
