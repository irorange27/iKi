import { getAppConfig } from '../../../core/config';
import * as chatThreadDb from '../../../core/db/chat_thread';
import * as emotionDb from '../../../core/db/emotion';
import * as memoryDb from '../../../core/db/memory';
import {
  buildAffectSystemMessage,
  collectEmotionSamples,
  computeAffectState,
} from '../../../core/emotion/affect_state';
import { generateLongMemorySummary } from '../../../core/memory/auto_summarize';
import { analyzeEmotionWithAgent } from '../../../core/provider/emotion_model';
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
  const emotionInFlight = new Set<string>();

  const getMemoryConfig = () => {
    const appConfig = getAppConfig();
    return appConfig?.memory || null;
  };

  const getEmotionConfig = () => {
    const memoryConfig = getMemoryConfig();
    return memoryConfig?.emotion || null;
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

  const canStoreShortMemory = () => {
    const memoryConfig = getMemoryConfig();
    return Boolean(memoryConfig?.enabled || memoryConfig?.autoSummarize);
  };

  const getAffectContextMessage = (threadId: string): string => {
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled || !emotionConfig.injectToSystemPrompt) return '';
    const fetchLimit = Math.max(
      10,
      Math.floor(emotionConfig.windowSize || 0) * 3,
      Math.floor(emotionConfig.minSampleCount || 0)
    );

    const events = emotionDb.listEmotionEvents(threadId, fetchLimit);
    let affectState = computeAffectState(collectEmotionSamples(events), emotionConfig);

    if (!affectState && canStoreShortMemory()) {
      const shortEntries = memoryDb.listShortMemory(threadId, fetchLimit);
      affectState = computeAffectState(collectEmotionSamples(shortEntries), emotionConfig);
    }

    if (!affectState) return '';
    return buildAffectSystemMessage(affectState);
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
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled) return;
    const thread = chatThreadDb.getChatThread(params.threadId);
    if (thread?.is_incognito) return;
    if (emotionInFlight.has(params.messageId)) return;

    const extracted = memoryDb.extractTextFromMessageJson(params.messageJson);
    if (!extracted || extracted.role !== 'user') return;

    const content = extracted.content.trim();
    if (!content) return;

    emotionInFlight.add(params.messageId);
    void (async () => {
      try {
        const emotion = await analyzeEmotionWithAgent(content);
        if (!emotion) return;

        emotionDb.addEmotionEvent({
          thread_id: params.threadId,
          message_id: params.messageId,
          role: extracted.role,
          emotion,
        });
        emotionDb.pruneEmotionEvents(params.threadId);

        if (canStoreShortMemory()) {
          const memoryConfig = getMemoryConfig();
          const forceShortMemory = Boolean(memoryConfig?.autoSummarize);
          memoryDb.addShortMemory(
            {
              thread_id: params.threadId,
              message_id: params.messageId,
              role: extracted.role,
              content: extracted.content,
              emotion,
            },
            forceShortMemory ? { force: true } : undefined
          );
        }
      } catch (error) {
        console.warn(
          `[Emotion][Main] analysis failed message=${params.messageId}:`,
          getErrorMessage(error)
        );
      } finally {
        emotionInFlight.delete(params.messageId);
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
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return messages;

    const systemMessages: ChatInputMessage[] = [];
    if (memoryConfig?.enabled) {
      const lastMessage = messages[messages.length - 1];
      const query = getPromptFromMessage(lastMessage);
      if (query.trim()) {
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

        if (results.length) {
          const systemContent = buildMemorySystemMessage(results);
          if (systemContent.trim()) {
            systemMessages.push({ role: 'system', content: systemContent });
          }
        }
      }
    }

    const affectContent = getAffectContextMessage(threadId);
    if (affectContent.trim()) {
      systemMessages.push({ role: 'system', content: affectContent });
    }

    if (!systemMessages.length) return messages;

    const insertIndex = messages.findIndex(message => message.role !== 'system');
    const headIndex = insertIndex === -1 ? messages.length : insertIndex;
    return [...messages.slice(0, headIndex), ...systemMessages, ...messages.slice(headIndex)];
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
