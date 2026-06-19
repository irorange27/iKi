import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../../logger';
import type { ChatMessageStore } from './chat_message_store';

export type UiMessagePersistence = ReturnType<typeof createUiMessagePersistence>;
const uiMessagePersistenceLogger = createLogger({ module: 'ui_message_persistence' });

export const createUiMessagePersistence = (deps: { electronAPI: Pick<ElectronApi, 'chat'> }) => {
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
    message: ChatUiMessage;
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
      await inFlightPersist;
    }

    const persistTask = (async () => {
      const serializedMessage = JSON.stringify(message);
      const metadata = JSON.stringify({ format: 'ai-ui-message-v1' });

      if (persistedMessageIds.has(message.id)) {
        await deps.electronAPI.chat.messages.update(message.id, {
          message: serializedMessage,
          metadata,
        });
        return;
      }

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
        uiMessagePersistenceLogger.event({
          level: 'warn',
          event: 'chat.message.persist',
          outcome: 'failed',
          error,
          entity: {
            message_id: message.id,
            thread_id: threadId,
          },
          data: {
            source,
            error_code: errorCode || 'unknown',
            error_message: errorMessage,
          },
        });

        if (
          errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
          errorMessage.includes('UNIQUE constraint failed: chat_messages.id')
        ) {
          persistedMessageIds.add(message.id);
          await deps.electronAPI.chat.messages.update(message.id, {
            message: serializedMessage,
            metadata,
          });
          uiMessagePersistenceLogger.event({
            level: 'warn',
            event: 'chat.message.persist',
            outcome: 'degraded',
            message: 'Duplicate renderer message persist resolved via update.',
            entity: {
              message_id: message.id,
              thread_id: threadId,
            },
            data: {
              source,
            },
          });
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
    messageStore: ChatMessageStore;
    messageIndex: number;
  }): Promise<void> => {
    const messagesToDelete = params.messageStore.messages.slice(params.messageIndex + 1);
    if (!messagesToDelete.length) return;

    const idsToDelete = messagesToDelete
      .map(message => (message && typeof message.id === 'string' ? message.id : ''))
      .filter(id => id.length > 0);

    if (idsToDelete.length === 0) {
      params.messageStore.truncateAfterIndex(params.messageIndex);
      return;
    }

    const inFlight = idsToDelete
      .map(id => messagePersistInFlight.get(id))
      .filter((promise): promise is Promise<void> => Boolean(promise));
    if (inFlight.length) {
      await Promise.allSettled(inFlight);
    }

    params.messageStore.truncateAfterIndex(params.messageIndex);

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
