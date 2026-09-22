import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { createLogger } from '@iki/backend/logger';
import type { ChatThread } from '@iki/backend/types/chat';
import type { AffectSignal } from '@iki/backend/types/affect';
import type { InterventionPolicySignal } from '@iki/backend/message/intervention_policy';
import { buildThreadRuntimeMetadata } from '@iki/backend/message/thread_runtime_hints';

const chatThreadHintsLogger = createLogger({ module: 'chat_thread_hints' });

export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
  providerId?: string;
  model: string;
  affectSignal?: AffectSignal | null;
  interventionPolicy?: InterventionPolicySignal | null;
}): void => {
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  if (!normalizedThreadId) return;

  try {
    const thread = chatThreadDb.getChatThread(normalizedThreadId);

    const update: Partial<ChatThread> = {
      model: params.model || thread?.model || null,
      metadata: JSON.stringify(
        buildThreadRuntimeMetadata({
          existingMetadata: thread?.metadata,
          providerType: params.providerType,
          providerId: params.providerId,
          model: params.model,
          affectSignal: params.affectSignal,
          interventionPolicy: params.interventionPolicy,
        })
      ),
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
