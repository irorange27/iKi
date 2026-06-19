import type { FileUIPart } from 'ai';
import type { ChatUiMessage, ComposerInvocationPartData } from '@iki/backend/chat/message_parts';
import type { AudioEmotionResult } from '@iki/backend/types/speech';

export type PrepareMessageSendPayload = {
  content: string;
  model?: string;
  providerId?: string;
  tools?: string[];
  mcpServerIds?: string[];
  promptAppId?: string;
  composerInvocations?: ComposerInvocationPartData;
  files?: FileUIPart[];
  audioEmotion?: AudioEmotionResult;
};

export type PreparedMessageSend = {
  threadId: string;
  messagesSnapshot: ChatUiMessage[];
};
