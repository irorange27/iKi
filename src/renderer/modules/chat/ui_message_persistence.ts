import type { UIMessage } from 'ai';

type ElectronAPI = {
  chat: {
    messages: {
      create: (input: Record<string, unknown>) => Promise<{ id?: string } | null>;
      update: (id: string, input: Record<string, unknown>) => Promise<unknown>;
      delete: (id: string) => Promise<unknown>;
    };
  };
};

export type UiMessagePersistence = ReturnType<typeof createUiMessagePersistence>;

export const createUiMessagePersistence = (deps: { electronAPI: ElectronAPI }) => {
  const persistedMessageIds = new Set<string>();
  const messagePersistInFlight = new Map<string, Promise<void>>();

  const resetPersistedMessageIds = (ids: string[] = []) => {
    persistedMessageIds.clear();
    for (const id of ids) {
      if (typeof id === 'string' && id.trim()) {
        persistedMessageIds.add(id.trim());
      }
    }
  };

  const upsertUiMessage = async (params: {
    message: UIMessage;
    threadId: string;
    parentId?: string;
    source?: string;
  }): Promise<void> => {
    const source = params.source || 'unknown';
    const threadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
    if (!threadId) return;

    const message = params.message;
    const persistKey = message.id;
    const inFlightPersist = messagePersistInFlight.get(persistKey);
    if (inFlightPersist) {
      console.log(
        `[ChatPersist][Renderer] waiting id=${persistKey} source=${source} parent=${params.parentId || 'null'}`
      );
      await inFlightPersist;
    }

    const persistTask = (async () => {
      const serializedMessage = JSON.stringify(message);
      const metadata = JSON.stringify({ format: 'ai-ui-message-v1' });

      if (persistedMessageIds.has(message.id)) {
        console.log(
          `[ChatPersist][Renderer] update id=${message.id} source=${source} thread=${threadId}`
        );
        await deps.electronAPI.chat.messages.update(message.id, {
          message: serializedMessage,
          metadata,
        });
        return;
      }

      console.log(
        `[ChatPersist][Renderer] create id=${message.id} source=${source} thread=${threadId} parent=${params.parentId || 'null'}`
      );

      try {
        const savedMessage = await deps.electronAPI.chat.messages.create({
          id: message.id,
          thread_id: threadId,
          parent_id: params.parentId || null,
          depth: 0,
          message: serializedMessage,
          timestamp: new Date().toISOString(),
          metadata,
        });

        if (savedMessage?.id) {
          message.id = savedMessage.id;
          persistedMessageIds.add(savedMessage.id);
        } else {
          persistedMessageIds.add(message.id);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code)
            : '';
        console.warn(
          `[ChatPersist][Renderer] create-failed id=${message.id} source=${source} code=${errorCode || 'unknown'} error=${errorMessage}`
        );

        if (
          errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
          errorMessage.includes('UNIQUE constraint failed: chat_messages.id')
        ) {
          persistedMessageIds.add(message.id);
          await deps.electronAPI.chat.messages.update(message.id, {
            message: serializedMessage,
            metadata,
          });
          console.warn(
            `[ChatPersist][Renderer] duplicate-resolved-via-update id=${message.id} source=${source}`
          );
          return;
        }

        throw error;
      }
    })();

    messagePersistInFlight.set(persistKey, persistTask);

    try {
      await persistTask;
    } finally {
      if (messagePersistInFlight.get(persistKey) === persistTask) {
        messagePersistInFlight.delete(persistKey);
      }
    }
  };

  const truncateConversationAfterIndex = async (params: {
    chat: { messages: unknown[] };
    messageIndex: number;
  }): Promise<void> => {
    const messagesToDelete = params.chat.messages.slice(params.messageIndex + 1) as unknown as UIMessage[];
    if (!messagesToDelete.length) return;

    const idsToDelete = messagesToDelete
      .map(message => (message && typeof message.id === 'string' ? message.id : ''))
      .filter(id => id.length > 0);

    if (idsToDelete.length === 0) {
      params.chat.messages.splice(params.messageIndex + 1, params.chat.messages.length);
      return;
    }

    const inFlight = idsToDelete
      .map(id => messagePersistInFlight.get(id))
      .filter((promise): promise is Promise<void> => Boolean(promise));
    if (inFlight.length) {
      await Promise.allSettled(inFlight);
    }

    params.chat.messages.splice(params.messageIndex + 1, params.chat.messages.length);

    for (const id of idsToDelete) {
      persistedMessageIds.delete(id);
      messagePersistInFlight.delete(id);
    }

    await Promise.allSettled(idsToDelete.map(id => deps.electronAPI.chat.messages.delete(id)));
  };

  return {
    resetPersistedMessageIds,
    truncateConversationAfterIndex,
    upsertUiMessage,
  };
};

