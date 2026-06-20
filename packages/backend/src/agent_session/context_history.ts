import * as chatMessageDb from '@iki/backend/db/chat_message';
import * as threadContextDb from '@iki/backend/db/thread_context';
import * as memoryDb from '@iki/backend/db/memory';
import {
  hasToolPartInModelMessageContent,
  sanitizeModelConversationMessages,
} from '@iki/core/agent/model_messages';
import {
  generateThreadSummary,
  type ThreadSummaryMessage,
} from './thread_summary';
import type { ModelCapability } from '@iki/core/utils/provider_models';
import type { ChatInputMessage } from '../chat_service/types';
import {
  buildMessagePreview,
  clipMessageToBudget,
  clipTextToTokenBudget,
  countMessageTokens,
  estimateTextTokens,
} from './context_helpers';
import type {
  ContextConfig,
  ConversationChunk,
  RecentHistoryContext,
  SummaryContext,
  ThreadSummaryState,
} from './context_types';

const toStoredThreadSummaryMessages = (threadId: string): ThreadSummaryMessage[] =>
  chatMessageDb
    .getChatMessages(threadId)
    .map(row => memoryDb.extractTextFromMessageJson(row.message))
    .filter(
      (entry): entry is { role: string; content: string } =>
        Boolean(entry) &&
        (entry?.role === 'user' || entry?.role === 'assistant') &&
        typeof entry?.content === 'string' &&
        entry.content.trim().length > 0
    )
    .map(entry => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: entry.content,
    }));

export const ensureThreadSummary = async (
  threadId: string,
  contextConfig: ContextConfig
): Promise<ThreadSummaryState | null> => {
  if (!threadId || !contextConfig.enabled) return null;

  const messages = toStoredThreadSummaryMessages(threadId);
  if (messages.length < Math.max(1, contextConfig.summaryTriggerMessages)) {
    threadContextDb.deleteThreadContext(threadId);
    return null;
  }

  const compactableCount = Math.max(
    0,
    messages.length - Math.max(1, contextConfig.summaryRecentMessages)
  );
  if (compactableCount <= 0) {
    threadContextDb.deleteThreadContext(threadId);
    return null;
  }

  const existing = threadContextDb.getThreadContext(threadId);
  const shouldRegenerate =
    !existing ||
    existing.covered_message_count <= 0 ||
    existing.covered_message_count > compactableCount;

  const deltaMessages = shouldRegenerate
    ? messages.slice(0, compactableCount)
    : messages.slice(existing.covered_message_count, compactableCount);

  if (deltaMessages.length === 0) {
    if (!existing?.summary.trim()) return null;
    return {
      summary: existing.summary,
      coveredMessageCount: existing.covered_message_count,
      sourceMessageCount: compactableCount,
      stale: existing.covered_message_count !== compactableCount,
    };
  }

  const generated = await generateThreadSummary({
    existingSummary: shouldRegenerate ? '' : existing?.summary,
    messages: deltaMessages,
  });

  if (!generated) {
    if (!existing?.summary.trim()) return null;
    return {
      summary: existing.summary,
      coveredMessageCount: existing.covered_message_count,
      sourceMessageCount: compactableCount,
      stale: true,
    };
  }

  threadContextDb.upsertThreadContext({
    thread_id: threadId,
    summary: generated.summary,
    covered_message_count: compactableCount,
    metadata: {
      sourceMessageCount: compactableCount,
      model: generated.model,
    },
  });

  return {
    summary: generated.summary,
    coveredMessageCount: compactableCount,
    sourceMessageCount: compactableCount,
    stale: false,
  };
};

const buildConversationChunks = (messages: ChatInputMessage[]): ConversationChunk[] => {
  const chunks: ConversationChunk[] = [];

  for (let index = 0; index < messages.length; ) {
    const currentMessage = messages[index];
    const assistantAnchorsToolExchange =
      currentMessage.role === 'assistant' && hasToolPartInModelMessageContent(currentMessage.content);

    if (assistantAnchorsToolExchange) {
      let nextIndex = index + 1;
      while (nextIndex < messages.length && messages[nextIndex]?.role === 'tool') {
        nextIndex += 1;
      }

      if (nextIndex > index + 1) {
        chunks.push({
          messages: messages.slice(index, nextIndex),
          preserveAtomically: true,
        });
        index = nextIndex;
        continue;
      }
    }

    chunks.push({
      messages: [currentMessage],
      preserveAtomically: false,
    });
    index += 1;
  }

  return chunks;
};

const buildRecentHistoryReason = (params: {
  compactedMessages: number;
  truncatedRecentMessages: number;
  droppedToolMessages: number;
}): string | undefined => {
  const reasons: string[] = [];

  if (params.compactedMessages > 0) {
    reasons.push('compacted older turns');
  }

  if (params.truncatedRecentMessages > 0) {
    reasons.push('clipped oversized recent text');
  }

  if (params.droppedToolMessages > 0) {
    reasons.push('removed orphaned tool messages');
  }

  if (reasons.length === 0) return undefined;
  if (reasons.length === 1) {
    return reasons[0] === 'compacted older turns'
      ? 'compacted older turns into summary/recent window'
      : reasons[0];
  }
  if (reasons.length === 2) {
    if (
      reasons[0] === 'compacted older turns' &&
      reasons[1] === 'clipped oversized recent text'
    ) {
      return 'compacted older turns and clipped oversized recent text';
    }
    return `${reasons[0]} and ${reasons[1]}`;
  }

  return `${reasons[0]}, ${reasons[1]}, and ${reasons[2]}`;
};

export const selectRecentHistory = (
  messages: ChatInputMessage[],
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): RecentHistoryContext => {
  const conversationMessages = messages.filter(message => message.role !== 'system');
  const systemMessages = messages.filter(message => message.role === 'system');
  const conversationChunks = buildConversationChunks(conversationMessages);
  const recentMessages: ChatInputMessage[] = [];
  let recentTokens = 0;
  let truncatedRecentMessages = 0;

  for (let chunkIndex = conversationChunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
    const chunk = conversationChunks[chunkIndex];
    const isLatestChunk = chunkIndex === conversationChunks.length - 1;
    const clippedChunkMessages = chunk.messages.map((message, messageIndex) => {
      const isLatestMessageInConversation =
        isLatestChunk && messageIndex === chunk.messages.length - 1;
      return isLatestMessageInConversation
        ? { message, truncated: false }
        : clipMessageToBudget(message, contextConfig.maxMessageTokens, modelCapability);
    });
    const nextMessages = clippedChunkMessages.map(entry => entry.message);
    const nextTokens = nextMessages.reduce(
      (sum, message) => sum + countMessageTokens(message, modelCapability),
      0
    );
    const nextTruncatedCount = clippedChunkMessages.filter(entry => entry.truncated).length;
    const exceedsBudget =
      recentMessages.length > 0 && recentTokens + nextTokens > contextConfig.maxRecentTokens;
    const exceedsCount =
      recentMessages.length > 0 &&
      recentMessages.length + nextMessages.length > Math.max(1, contextConfig.recentMessageCount);

    if (exceedsBudget || exceedsCount) {
      if (!chunk.preserveAtomically) {
        break;
      }

      recentMessages.unshift(...nextMessages);
      recentTokens += nextTokens;
      truncatedRecentMessages += nextTruncatedCount;
      break;
    }

    recentMessages.unshift(...nextMessages);
    recentTokens += nextTokens;
    truncatedRecentMessages += nextTruncatedCount;
  }

  const sanitizedRecentHistory = sanitizeModelConversationMessages(recentMessages);
  const compactedMessages = Math.max(
    0,
    conversationMessages.length - sanitizedRecentHistory.messages.length
  );
  const reason = buildRecentHistoryReason({
    compactedMessages,
    truncatedRecentMessages,
    droppedToolMessages: sanitizedRecentHistory.droppedMessages,
  });
  const sanitizedRecentTokens = sanitizedRecentHistory.messages.reduce(
    (sum, message) => sum + countMessageTokens(message, modelCapability),
    0
  );

  return {
    systemMessages,
    recentMessages: sanitizedRecentHistory.messages,
    compactedMessages,
    block: {
      kind: 'recent-history',
      status:
        compactedMessages > 0 ||
        truncatedRecentMessages > 0 ||
        sanitizedRecentHistory.droppedMessages > 0
          ? 'truncated'
          : 'included',
      estimatedTokens: sanitizedRecentTokens,
      charCount: sanitizedRecentHistory.messages.reduce(
        (sum, message) => sum + buildMessagePreview(message).length,
        0
      ),
      ...(reason ? { reason } : {}),
      sourceCount: sanitizedRecentHistory.messages.length,
    },
  };
};

export const buildThreadSummaryContext = (
  threadSummary: ThreadSummaryState | null,
  compactedMessages: number,
  contextConfig: ContextConfig,
  _modelCapability?: ModelCapability | null
): SummaryContext => {
  const summaryClip = threadSummary?.summary
    ? clipTextToTokenBudget(threadSummary.summary, contextConfig.maxSummaryTokens)
    : { text: '', truncated: false };

  if (threadSummary?.summary) {
    return {
      systemMessage: `Thread summary:\n${summaryClip.text}`,
      block: {
        kind: 'thread-summary',
        status: summaryClip.truncated ? 'truncated' : 'included',
        estimatedTokens: estimateTextTokens(summaryClip.text),
        charCount: summaryClip.text.length,
        ...(summaryClip.truncated ? { reason: 'thread summary clipped to context budget' } : {}),
        sourceCount: threadSummary.sourceMessageCount,
      },
    };
  }

  return {
    systemMessage: '',
    block: {
      kind: 'thread-summary',
      status: 'dropped',
      estimatedTokens: 0,
      charCount: 0,
      reason: compactedMessages > 0 ? 'summary unavailable' : 'thread too short for summarization',
    },
  };
};
