import * as chatThreadDb from '@iki/store/chat_thread';
import { createLogger } from '@iki/core/logger';
import type { ChatThread } from '@iki/core/types/chat';

const chatThreadHintsLogger = createLogger({ module: 'chat_thread_hints' });

/**
 * Remember which provider/model served this thread, as fields on the row.
 * `patchRow` stamps `updated_at`, so the binding's freshness is the row's
 * freshness — there is no nested "runtime hints" document to merge anymore.
 */
export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
  providerId?: string;
  model: string;
}): void => {
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  if (!normalizedThreadId) return;

  try {
    const thread = chatThreadDb.getChatThread(normalizedThreadId);

    const update: Partial<ChatThread> = {
      model: params.model || thread?.model || undefined,
      provider_type: params.providerType,
      provider_id: params.providerId?.trim() || null,
    };
    chatThreadDb.updateChatThread(normalizedThreadId, update);
  } catch (error) {
    chatThreadHintsLogger.event({
      level: 'warn',
      event: 'chat.thread_hints.persist',
      outcome: 'failed',
      error,
      entity: {
        thread_id: normalizedThreadId,
      },
    });
  }
};
