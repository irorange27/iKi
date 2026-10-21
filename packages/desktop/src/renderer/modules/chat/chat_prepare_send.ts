import type { UiFilePart as FileUIPart } from '@iki/backend/message/ui_protocol';
import type { ChatUiMessage, ComposerInvocationPartData } from '@iki/backend/message/message_parts';

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
  /** Built (and persisted) user message; the Chat appends it on send. */
  userMessage: ChatUiMessage;
  /** Set when an existing user message was edited in place. */
  editedMessageId?: string;
};
