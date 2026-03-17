import type { UIMessage } from 'ai';

export type ChatMessageStore = ReturnType<typeof createChatMessageStore>;

export const createChatMessageStore = (chat: { messages: unknown[] }) => {
  const messages = chat.messages as UIMessage[];

  const findIndexById = (id: string | null | undefined): number => {
    if (!id) return -1;
    return messages.findIndex(message => message.id === id);
  };

  const getById = (id: string | null | undefined): UIMessage | undefined => {
    if (!id) return undefined;
    return messages.find(message => message.id === id);
  };

  const getAt = (index: number): UIMessage | undefined => messages[index] as UIMessage | undefined;

  const append = (message: UIMessage) => {
    messages.push(message);
  };

  const replaceAt = (index: number, message: UIMessage) => {
    if (index >= 0) {
      messages.splice(index, 1, message);
    } else {
      messages.push(message);
    }
  };

  const removeAt = (index: number) => {
    if (index >= 0) {
      messages.splice(index, 1);
    }
  };

  const upsert = (message: UIMessage) => {
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
  };

  const setAll = (next: UIMessage[]) => {
    messages.splice(0, messages.length, ...next);
  };

  const truncateAfterIndex = (index: number): UIMessage[] => {
    const start = Math.max(index + 1, 0);
    if (start >= messages.length) return [];
    return messages.splice(start, messages.length - start) as UIMessage[];
  };

  const hasId = (id: string | null | undefined): boolean => findIndexById(id) >= 0;

  const snapshot = (): UIMessage[] => [...messages];

  const findLatestUserBefore = (index: number): UIMessage | undefined => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const message = messages[i] as UIMessage | undefined;
      if (message && message.role === 'user' && typeof message.id === 'string') {
        return message;
      }
    }
    return undefined;
  };

  return {
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
