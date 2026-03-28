import type { ChatUiMessage } from '../../../shared/chat/message_parts';

export type PrepareMessageSendPayload = {
  content: string;
  model?: string;
  providerId?: string;
  tools?: string[];
  mcpServerIds?: string[];
};

export type PreparedMessageSend = {
  threadId: string;
  messagesSnapshot: ChatUiMessage[];
};
