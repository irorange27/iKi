import * as chatThreadDb from '../../../core/db/chat_thread';
import { isObjectRecord } from './chat_ui';

export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
  model: string;
  tools: string[];
}): void => {
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  if (!normalizedThreadId) return;

  try {
    const thread = chatThreadDb.getChatThread(normalizedThreadId);
    let parsedMetadata: unknown = {};
    try {
      parsedMetadata =
        thread?.metadata && thread.metadata.trim().length > 0 ? JSON.parse(thread.metadata) : {};
    } catch {
      parsedMetadata = {};
    }

    const metadataRecord = isObjectRecord(parsedMetadata) ? parsedMetadata : {};
    const nextLlm = isObjectRecord(metadataRecord.llm) ? metadataRecord.llm : {};

    chatThreadDb.updateChatThread(normalizedThreadId, {
      model: params.model || thread?.model || null,
      tools: params.tools.length > 0 ? JSON.stringify(params.tools) : null,
      metadata: JSON.stringify({
        ...metadataRecord,
        llm: {
          ...(nextLlm as Record<string, unknown>),
          providerType: params.providerType,
          model: params.model,
          updatedAt: new Date().toISOString(),
        },
      }),
    } as any);
  } catch (error) {
    console.warn('[Main] Failed to persist thread runtime hints:', error);
  }
};

