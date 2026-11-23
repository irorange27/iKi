import type { UiFilePart as FileUIPart } from '@iki/llm/message/ui_protocol';
import type { ChatUiMessage, ComposerInvocationPartData } from '@iki/llm/message/message_parts';

export type PrepareMessageSendPayload = {
  content: string;
  model?: string;
  providerId?: string;
  promptAppId?: string;
  composerInvocations?: ComposerInvocationPartData;
  files?: FileUIPart[];
};

export type PreparedMessageSend = {
  threadId: string;
  
  userMessage: ChatUiMessage;
  
  editedMessageId?: string;
};
