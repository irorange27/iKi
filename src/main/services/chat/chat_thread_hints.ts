import * as chatThreadDb from '../../../core/db/chat_thread';
import type { ChatThread } from '../../../shared/types/chat';
import type { AffectSignal } from '../../../shared/emotion/affect';
import {
  buildThreadRuntimeMetadata,
  normalizeStringArray,
} from '../../../shared/chat/thread_runtime_hints';

export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
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
          model: params.model,
          toolMode: params.toolMode,
          mcpServerIds: params.mcpServerIds,
          affectSignal: params.affectSignal,
        })
      ),
    };
    chatThreadDb.updateChatThread(normalizedThreadId, update);
  } catch (error) {
    console.warn('[Main] Failed to persist thread runtime hints:', error);
  }
};
