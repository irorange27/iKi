import * as chatThreadDb from '../../../core/db/chat_thread';
import type { ChatThread } from '../../../shared/types/chat';
import { isObjectRecord } from '../../../shared/chat/tool_parts';

export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
  model: string;
  tools: string[];
  toolMode: 'manual' | 'auto';
  mcpServerIds?: string[];
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
    const nextToolSelection = isObjectRecord(metadataRecord.toolSelection)
      ? metadataRecord.toolSelection
      : {};
    const normalizedMcpServerIds = Array.isArray(params.mcpServerIds)
      ? params.mcpServerIds
          .filter((serverId): serverId is string => typeof serverId === 'string')
          .map(serverId => serverId.trim())
          .filter(Boolean)
      : [];

    const update: Partial<ChatThread> = {
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
        toolSelection: {
          ...(nextToolSelection as Record<string, unknown>),
          mode: params.toolMode,
          mcpServerIds: normalizedMcpServerIds,
          updatedAt: new Date().toISOString(),
        },
      }),
    };
    chatThreadDb.updateChatThread(normalizedThreadId, update);
  } catch (error) {
    console.warn('[Main] Failed to persist thread runtime hints:', error);
  }
};
