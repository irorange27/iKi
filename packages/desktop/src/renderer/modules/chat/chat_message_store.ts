import { ref } from 'vue';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

export type ChatMessageStore = ReturnType<typeof createChatMessageStore>;

export const createChatMessageStore = (chat: { messages: unknown[] }) => {
  const messages = chat.messages as ChatUiMessage[];
  const revision = ref(0);

  const findIndexById = (id: string | null | undefined): number => {
    if (!id) return -1;
    return messages.findIndex(message => message.id === id);
  };

  const getById = (id: string | null | undefined): ChatUiMessage | undefined => {
    if (!id) return undefined;
    return messages.find(message => message.id === id);
  };

  const getAt = (index: number): ChatUiMessage | undefined =>
    messages[index] as ChatUiMessage | undefined;

  const append = (message: ChatUiMessage) => {
    messages.push(message);
    revision.value += 1;
  };

  const replaceAt = (index: number, message: ChatUiMessage) => {
    if (index >= 0) {
      messages.splice(index, 1, message);
    } else {
      messages.push(message);
    }
    revision.value += 1;
  };

  const removeAt = (index: number) => {
    if (index >= 0) {
      messages.splice(index, 1);
      revision.value += 1;
    }
  };

  const upsert = (message: ChatUiMessage) => {
    const index = findIndexById(message.id);
    replaceAt(index, message);
    return index;
  };

  const removeById = (id: string) => {
    const index = findIndexById(id);
    removeAt(index);
    return index;
  };

  const clear = () => {
    messages.splice(0, messages.length);
    revision.value += 1;
  };

  const setAll = (next: ChatUiMessage[]) => {
    messages.splice(0, messages.length, ...next);
    revision.value += 1;
  };

  const truncateAfterIndex = (index: number): ChatUiMessage[] => {
    const start = Math.max(index + 1, 0);
    if (start >= messages.length) return [];
    const removed = messages.splice(start, messages.length - start) as ChatUiMessage[];
    revision.value += 1;
    return removed;
  };

  const hasId = (id: string | null | undefined): boolean => findIndexById(id) >= 0;

  const snapshot = (): ChatUiMessage[] => [...messages];

  const findLatestUserBefore = (index: number): ChatUiMessage | undefined => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const message = messages[i] as ChatUiMessage | undefined;
      if (message && message.role === 'user' && typeof message.id === 'string') {
        return message;
      }
    }
    return undefined;
  };

  return {
    get revision() {
      return revision.value;
    },
    messages,
    getById,
    getAt,
    findIndexById,
    append,
    replaceAt,
    removeAt,
    upsert,
    removeById,
    clear,
    setAll,
    truncateAfterIndex,
    hasId,
    snapshot,
    findLatestUserBefore,
  };
};
