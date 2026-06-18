import type { ChatUiMessage } from '@iki/core/chat/message_parts';
import type { MessageOp, StreamContext, StreamState } from './ui_stream_reducer_types';

export const resetTransientState = (state: StreamState): StreamState => ({
  ...state,
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
});

export const updateAssistantMessage = (
  state: StreamState,
  ctx: StreamContext,
  build: (message: ChatUiMessage) => ChatUiMessage | null
): { state: StreamState; messageOps: MessageOp[]; updatedMessage?: ChatUiMessage } => {
  const messageId = state.activeAssistantMessageId;
  const existingIndex = messageId
    ? ctx.messages.findIndex(message => message.id === messageId)
    : -1;

  let baseMessage: ChatUiMessage;
  let nextState = state;
  const existed = existingIndex >= 0;

  if (existed) {
    baseMessage = ctx.messages[existingIndex];
  } else {
    baseMessage = {
      id: ctx.createMessageId(),
      role: 'assistant',
      parts: [],
    };
    nextState = {
      ...state,
      activeAssistantMessageId: baseMessage.id,
    };
  }

  const updated = build(baseMessage);
  const messageOps: MessageOp[] = [];

  if (updated) {
    messageOps.push({
      type: existed ? 'replace' : 'append',
      messageId: updated.id,
      message: updated,
    });
  } else if (existed) {
    messageOps.push({
      type: 'remove',
      messageId: baseMessage.id,
    });
  }

  return { state: nextState, messageOps, updatedMessage: updated ?? undefined };
};
