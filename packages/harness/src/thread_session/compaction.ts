import type { ModelMessage } from '@iki/llm/message/model_history';
import { toModelInputMessages } from '@iki/llm/message/ui_messages';
import {
  compactPiRequestStep,
  findFirstKeptInitialIndex,
} from '../agent/turn/turn_budget';
import { frameCheckpoint } from '../runtimes/compaction_prompt';
import {
  compactionCheckpointToEvent,
  mapUiMessagesToModelIds,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  selectMessagesForCompaction,
} from './session_log';

export type ManualCompactionResult =
  | {
      compacted: true;
      omittedCount: number;
      keptCount: number;
      firstKeptMessageId?: string;
      summary: string;
    }
  | {
      compacted: false;
      reason: string;
    };

export const compactThreadNow = async (threadId: string): Promise<ManualCompactionResult> => {
  const normalizedId = threadId.trim();
  if (!normalizedId) {
    return { compacted: false, reason: 'No active thread.' };
  }

  const view = rebuildThreadViewFromEvents(normalizedId);
  const active = selectMessagesForCompaction(view.messages, view.compaction);
  const initialConversation = (await toModelInputMessages(active.messages)).filter(
    message => message.role !== 'system'
  );
  if (initialConversation.length < 2) {
    return { compacted: false, reason: 'Nothing older to compact yet (need at least 2 turns).' };
  }

  const initialModelMessageIds = await mapUiMessagesToModelIds(active.messages, true);
  const existingSummary = view.compaction?.summary?.trim() || undefined;
  const previousSummaryMessage: ModelMessage | undefined = existingSummary
    ? { role: 'user', content: frameCheckpoint(existingSummary) }
    : undefined;
  const requestView = previousSummaryMessage
    ? [previousSummaryMessage, ...initialConversation]
    : initialConversation;

  const planned = await compactPiRequestStep({
    requestView,
    maxInputTokens: Number.MAX_SAFE_INTEGER,
    overheadTokens: 0,
    force: true,
    threadId: normalizedId,
    ...(existingSummary ? { existingSummary } : {}),
    ...(previousSummaryMessage ? { previousSummaryMessage } : {}),
  });
  if (!planned.compacted) {
    return { compacted: false, reason: 'Nothing older to compact in the active window.' };
  }

  const firstKeptInitialIndex = findFirstKeptInitialIndex(initialConversation, planned.requestView);
  const firstKeptMessageId =
    firstKeptInitialIndex >= 0 ? initialModelMessageIds[firstKeptInitialIndex] : undefined;
  const compactedAt = new Date().toISOString();

  recordSessionEvents(normalizedId, [
    compactionCheckpointToEvent({
      summary: planned.summaryText,
      ...(firstKeptMessageId ? { firstKeptMessageId } : {}),
      omittedCount: planned.omittedCount,
      keptCount: planned.keptCount,
      compactedAt,
    }),
  ]);

  return {
    compacted: true,
    omittedCount: planned.omittedCount,
    keptCount: planned.keptCount,
    ...(firstKeptMessageId ? { firstKeptMessageId } : {}),
    summary: planned.summaryText,
  };
};
