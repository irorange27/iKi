import type { FileUIPart } from 'ai';
import type { ChatUiMessage, ComposerInvocationPartData } from '@iki/backend/message/message_parts';
import type { AudioEmotionResult } from '@iki/backend/types/speech';

export type PrepareMessageSendPayload = {
  content: string;
  model?: string;
  providerId?: string;
  promptAppId?: string;
  composerInvocations?: ComposerInvocationPartData;
  files?: FileUIPart[];
  audioEmotion?: AudioEmotionResult;
};

export type PreparedMessageSend = {
  threadId: string;
  /** Built (and persisted) user message; the Chat appends it on send. */
  userMessage: ChatUiMessage;
  /** Set when an existing user message was edited in place. */
  editedMessageId?: string;
};
