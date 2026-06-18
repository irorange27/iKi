import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import { normalizeUiMessage } from '@iki/backend/chat/ui_message_codec';
import { createPrefixedId } from '@iki/core/utils/id';

const makeUiMessageId = () => createPrefixedId('ui', { randomLength: 6 });

export const toUiMessages = (messages: unknown[]): ChatUiMessage[] => {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message, index) =>
      normalizeUiMessage(message, {
        fallbackId: `${makeUiMessageId()}_${index}`,
        fallbackRole: 'user',
      })
    )
    .filter((message): message is ChatUiMessage => message !== null);
};
