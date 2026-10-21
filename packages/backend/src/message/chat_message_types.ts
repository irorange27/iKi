import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { ModelMessage } from './model_history';

export type ChatInputMessage = ModelMessage;

export type ChatTransportMessage = ChatInputMessage | ChatUiMessage;

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
