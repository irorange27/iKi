import { getConfig } from '../../../core/db/database';
import * as chatThreadDb from '../../../core/db/chat_thread';
import * as memoryDb from '../../../core/db/memory';
import { generateLongMemorySummary } from '../../../core/memory/auto_summarize';
import { analyzeEmotionWithAgent } from '../../../core/provider/emotion_model';
import type { AppConfig } from '../../../shared/types/config';
import { getErrorMessage } from '../../utils/errors';
import type { ChatInputMessage } from './chat_types';

type MemoryPreview = {
  id: string;
  summary: string;
  score: number;
  updated_at?: string;
  tags?: string | null;
};

type MemoryRetrievalPayload = {
  query: string;
  results: MemoryPreview[];
};
import { getPromptFromMessage } from './chat_ui';

const formatMemoryLine = (entry: { summary: string; score: number; updated_at?: string }) => {
  const score = Number.isFinite(entry.score) ? entry.score.toFixed(3) : '0.000';
  const dateText = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '';
  const summary = entry.summary.trim().replace(/\s+/g, ' ');
  return dateText ? `- (${score}, ${dateText}) ${summary}` : `- (${score}) ${summary}`;
};

const buildMemorySystemMessage = (
  entries: Array<{ summary: string; score: number; updated_at?: string }>
): string => {
  if (!entries.length) return '';
  const lines = entries.map(formatMemoryLine);
  return ['Long-term memory (use only if relevant; ignore if unrelated):', ...lines].join('\n');
};

export const createChatMemory = () => {
  const memorySummarizeInFlight = new Set<string>();

  const getMemoryConfig = () => {
    const appConfig = getConfig('app_config') as AppConfig | null;
    return appConfig?.memory || null;
  };

  const shouldAutoSummarizeThread = (threadId: string): boolean => {
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.autoSummarize) return false;
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return false;
    return true;
  };

  const wasMessageSummarized = (threadId: string, messageId: string): boolean => {
    if (!threadId || !messageId) return false;
    const recent = memoryDb.listLongMemory(threadId, 25);
    for (const entry of recent) {
      if (!entry.source_message_ids) continue;
      try {
        const parsed = JSON.parse(entry.source_message_ids);
        if (Array.isArray(parsed) && parsed.includes(messageId)) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  };

  const maybeAutoSummarizeLongMemory = async (
    threadId: string,
    messageId: string,
    messageJson?: string
  ): Promise<void> => {
    if (!threadId || !messageId || typeof messageJson !== 'string') return;
    if (!shouldAutoSummarizeThread(threadId)) return;

    const extracted = memoryDb.extractTextFromMessageJson(messageJson);
    if (!extracted || extracted.role !== 'assistant') return;
    if (!extracted.content || !extracted.content.trim()) return;

    if (wasMessageSummarized(threadId, messageId)) return;
    if (memorySummarizeInFlight.has(threadId)) return;
    memorySummarizeInFlight.add(threadId);

    try {
      const shortEntries = memoryDb.listShortMemory(threadId, 50);
      const summary = await generateLongMemorySummary(shortEntries);
      if (!summary) return;

      const normalizedSummary = summary.summary.trim().toLowerCase();
      const recentLong = memoryDb.listLongMemory(threadId, 10);
      if (
        recentLong.some(
          entry => entry.summary && entry.summary.trim().toLowerCase() === normalizedSummary
        )
      ) {
        return;
      }

      memoryDb.addLongMemory(
        {
          thread_id: threadId,
          summary: summary.summary,
          source_message_ids: summary.sourceMessageIds,
          metadata: {
            source: 'auto',
            model: summary.model,
            messageIds: summary.sourceMessageIds,
          },
        },
        { force: true }
      );
    } finally {
      memorySummarizeInFlight.delete(threadId);
    }
  };

  const queueEmotionAnalysis = (params: { threadId: string; messageId: string; messageJson: string }) => {
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.enabled) return;

    const extracted = memoryDb.extractTextFromMessageJson(params.messageJson);
    if (!extracted || extracted.role !== 'user') return;

    const content = extracted.content.trim();
    if (!content) return;

    void (async () => {
      try {
        const emotion = await analyzeEmotionWithAgent(content);
        if (!emotion) return;
        memoryDb.addShortMemory({
          thread_id: params.threadId,
          message_id: params.messageId,
          role: extracted.role,
          content: extracted.content,
          emotion,
        });
      } catch (error) {
        console.warn(
          `[Emotion][Main] analysis failed message=${params.messageId}:`,
          getErrorMessage(error)
        );
      }
    })();
  };

  const injectMemoryIntoMessages = (
    messages: ChatInputMessage[],
    threadId?: string,
    options?: {
      onRetrieved?: (payload: MemoryRetrievalPayload) => void;
    }
  ): ChatInputMessage[] => {
    if (!threadId) return messages;
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.enabled) return messages;
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return messages;

    const lastMessage = messages[messages.length - 1];
    const query = getPromptFromMessage(lastMessage);
    if (!query.trim()) return messages;

    const results = memoryDb.searchLongMemoryAcrossThreads(query, {
      limit: memoryConfig.maxRetrievalCount,
      threshold: memoryConfig.similarThreshold,
    });

    if (options?.onRetrieved) {
      const preview: MemoryPreview[] = results.map(entry => ({
        id: entry.id,
        summary: entry.summary,
        score: entry.score,
        updated_at: entry.updated_at,
        tags: entry.tags,
      }));
      options.onRetrieved({ query, results: preview });
    }

    if (!results.length) return messages;
    const systemContent = buildMemorySystemMessage(results);
    if (!systemContent.trim()) return messages;

    const insertIndex = messages.findIndex(message => message.role !== 'system');
    const headIndex = insertIndex === -1 ? messages.length : insertIndex;
    const memoryMessage: ChatInputMessage = {
      role: 'system',
      content: systemContent,
    };

    return [...messages.slice(0, headIndex), memoryMessage, ...messages.slice(headIndex)];
  };

  const onMessagePersisted = (params: { threadId: string; messageId: string; messageJson: string }) => {
    try {
      if (!params.threadId || !params.messageId || typeof params.messageJson !== 'string') return;
      const memoryConfig = getMemoryConfig();
      const forceShortMemory = Boolean(memoryConfig?.autoSummarize);

      memoryDb.addShortMemoryFromChatMessage(
        {
          thread_id: params.threadId,
          message_id: params.messageId,
          message_json: params.messageJson,
        },
        forceShortMemory ? { force: true } : undefined
      );
      memoryDb.pruneShortMemory(params.threadId);

      queueEmotionAnalysis({
        threadId: params.threadId,
        messageId: params.messageId,
        messageJson: params.messageJson,
      });

      void maybeAutoSummarizeLongMemory(params.threadId, params.messageId, params.messageJson);
    } catch (error) {
      console.warn('[Memory][Main] short memory upsert failed:', getErrorMessage(error));
    }
  };

  return { injectMemoryIntoMessages, onMessagePersisted };
};

export type ChatMemory = ReturnType<typeof createChatMemory>;
