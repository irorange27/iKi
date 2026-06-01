import type { FileUIPart } from 'ai';
import type { ChatUiMessage, ComposerInvocationPartData } from '../../../shared/chat/message_parts';
import type { AudioEmotionResult } from '../../../shared/types/speech';

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
