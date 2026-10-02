import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { ModelMessage } from 'ai';

/** A turn-prep/turn-execution input message: the AI SDK's model message. */
export type ChatInputMessage = ModelMessage;

/**
 * What an entry hands to turn preparation: either an already-converted model
 * message (rehydration paths) or a UI message from a client (fresh input).
 */
export type ChatTransportMessage = ChatInputMessage | ChatUiMessage;

/** A plain three-role chat message for single-shot generation. */
export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
