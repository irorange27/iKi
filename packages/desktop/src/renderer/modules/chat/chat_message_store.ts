import { ref } from 'vue';
import type { ChatUiMessage } from '@iki/ai/message/message_parts';

export type ChatMessageStore = ReturnType<typeof createChatMessageStore>;

export const createChatMessageStore = (chat: { messages: unknown[] }) => {
  const messages = chat.messages as ChatUiMessage[];
  const revision = ref(0);

  const findIndexById = (id: string | null | undefined): number => {
    if (!id) return -1;
    return messages.findIndex(message => message.id === id);
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

  const removeById = (id: string) => {
    const index = findIndexById(id);
    if (index >= 0) {
      messages.splice(index, 1);
      revision.value += 1;
    }
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

  return {
    get revision() {
      return revision.value;
    },
    messages,
    getAt,
    findIndexById,
    append,
    replaceAt,
    removeById,
    clear,
    setAll,
    truncateAfterIndex,
    hasId,
    snapshot,
  };
};
