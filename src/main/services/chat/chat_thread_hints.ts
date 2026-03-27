import * as chatThreadDb from '../../../core/db/chat_thread';
import { createLogger } from '../../../core/logger';
import type { ChatThread } from '../../../shared/types/chat';
import type { AffectSignal } from '../../../shared/emotion/affect';
import {
  buildThreadRuntimeMetadata,
  normalizeStringArray,
} from '../../../shared/chat/thread_runtime_hints';

const chatThreadHintsLogger = createLogger({ module: 'chat_thread_hints' });

export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
  providerId?: string;
  model: string;
  tools: string[];
  toolMode: 'manual' | 'auto';
  mcpServerIds?: string[];
  affectSignal?: AffectSignal | null;
}): void => {
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  if (!normalizedThreadId) return;

  try {
    const thread = chatThreadDb.getChatThread(normalizedThreadId);
    const normalizedTools = normalizeStringArray(params.tools);

    const update: Partial<ChatThread> = {
      model: params.model || thread?.model || null,
      tools: normalizedTools.length > 0 ? JSON.stringify(normalizedTools) : null,
      metadata: JSON.stringify(
        buildThreadRuntimeMetadata({
          existingMetadata: thread?.metadata,
          providerType: params.providerType,
          providerId: params.providerId,
          model: params.model,
          toolMode: params.toolMode,
          mcpServerIds: params.mcpServerIds,
          affectSignal: params.affectSignal,
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
