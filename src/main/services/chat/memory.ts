import { getAppConfig } from '../../../core/config';
import * as affectDb from '../../../core/db/affect_state';
import * as chatThreadDb from '../../../core/db/chat_thread';
import * as emotionDb from '../../../core/db/emotion';
import * as memoryDb from '../../../core/db/memory';
import {
  type AffectState,
  buildAffectSystemMessage,
  collectEmotionSamples,
  computeAffectState,
} from '../../../core/emotion/affect_state';
import { createLogger } from '../../../core/logger';
import { generateLongMemorySummary } from '../../../core/memory/auto_summarize';
import {
  analyzeEmotionWithAgent,
  type EmotionResult,
} from '../../../core/provider/emotion_model';
import { planMemoryRetrieval } from '../../../core/provider/memory_retrieval';
import { isAffectLabel } from '../../../shared/emotion/affect';
import type { AudioEmotionResult } from '../../../shared/types/speech';
import { parseJsonStringArray } from '../../../shared/utils/json';
import { getErrorMessage } from '../../utils/errors';
import type { ChatInputMessage } from './types';
import { getPromptFromMessage } from './ui_messages';

const chatMemoryLogger = createLogger({ module: 'chat_memory' });

type MemoryPreview = {
  id: string;
  summary: string;
  score: number;
  updated_at?: string;
  tags?: string[];
  sourceMessageCount?: number;
};

type MemoryRetrievalPayload = {
  query: string;
  results: MemoryPreview[];
  systemMessage: string;
};

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

const EMOTION_CACHE_TTL_MS = 2 * 60 * 1000;
const EMOTION_CACHE_LIMIT = 200;

const hashText = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const createChatMemory = () => {
  const memorySummarizeInFlight = new Set<string>();
  const emotionAnalysisInFlight = new Map<string, Promise<void>>();
  const realtimeEmotionCache = new Map<string, { emotion: EmotionResult; createdAt: number }>();
  const realtimeEmotionAnalysisInFlight = new Map<string, Promise<EmotionResult | null>>();

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

  const buildEmotionCacheKey = (threadId: string, content: string) =>
    `${threadId}:${hashText(content)}`;

  const pruneRealtimeEmotionCache = () => {
    const now = Date.now();
    for (const [key, entry] of realtimeEmotionCache) {
      if (now - entry.createdAt > EMOTION_CACHE_TTL_MS) {
        realtimeEmotionCache.delete(key);
      }
    }
    while (realtimeEmotionCache.size > EMOTION_CACHE_LIMIT) {
      const oldestKey = realtimeEmotionCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      realtimeEmotionCache.delete(oldestKey);
    }
  };

  const recordRealtimeEmotion = (threadId: string, content: string, emotion: EmotionResult) => {
    if (!threadId) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    pruneRealtimeEmotionCache();
    const key = buildEmotionCacheKey(threadId, trimmed);
    realtimeEmotionCache.set(key, { emotion, createdAt: Date.now() });
  };

  const consumeRealtimeEmotion = (threadId: string, content: string): EmotionResult | null => {
    if (!threadId) return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    pruneRealtimeEmotionCache();
    const key = buildEmotionCacheKey(threadId, trimmed);
    const entry = realtimeEmotionCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > EMOTION_CACHE_TTL_MS) {
      realtimeEmotionCache.delete(key);
      return null;
    }
    realtimeEmotionCache.delete(key);
    return entry.emotion;
  };

  const peekRealtimeEmotion = (threadId: string, content: string): EmotionResult | null => {
    if (!threadId) return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    pruneRealtimeEmotionCache();
    const key = buildEmotionCacheKey(threadId, trimmed);
    const entry = realtimeEmotionCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > EMOTION_CACHE_TTL_MS) {
      realtimeEmotionCache.delete(key);
      return null;
    }
    return entry.emotion;
  };

  const analyzeRealtimeEmotion = (
    threadId: string,
    content: string
  ): Promise<EmotionResult | null> => {
    const trimmed = content.trim();
    if (!threadId || !trimmed) {
      return Promise.resolve(null);
    }

    const cachedEmotion = peekRealtimeEmotion(threadId, trimmed);
    if (cachedEmotion) {
      return Promise.resolve(cachedEmotion);
    }

    const cacheKey = buildEmotionCacheKey(threadId, trimmed);
    const inFlight = realtimeEmotionAnalysisInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = analyzeEmotionWithAgent(trimmed)
      .then(emotion => {
        if (emotion) {
          recordRealtimeEmotion(threadId, trimmed, emotion);
        }
        return emotion;
      })
      .finally(() => {
        realtimeEmotionAnalysisInFlight.delete(cacheKey);
      });

    realtimeEmotionAnalysisInFlight.set(cacheKey, promise);
    return promise;
  };

  const preloadRealtimeEmotion = (threadId: string | undefined, content: string) => {
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled || !emotionConfig.injectToSystemPrompt || !emotionConfig.realtimeAnalysis) {
      return;
    }

    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    const trimmed = content.trim();
    if (!normalizedThreadId || !trimmed) return;

    const thread = chatThreadDb.getChatThread(normalizedThreadId);
    if (thread?.is_incognito) return;

    void analyzeRealtimeEmotion(normalizedThreadId, trimmed).catch(error => {
      chatMemoryLogger.event({
        level: 'warn',
        event: 'chat.memory.realtime_emotion_preload',
        outcome: 'failed',
        error,
        entity: {
          thread_id: normalizedThreadId,
        },
        data: {
          error_message: getErrorMessage(error),
        },
      });
    });
  };

  const getAffectContextMessage = (threadId: string): string => {
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled || !emotionConfig.injectToSystemPrompt) return '';
    const affectState = computeAffectStateForThread(threadId);
    if (!affectState) return '';
    return buildAffectSystemMessage(affectState);
  };

  const buildRealtimeAffectContext = async (
    threadId: string | undefined,
    content: string,
    options?: { force?: boolean }
  ): Promise<{ message: string; state: AffectState | null }> => {
    try {
      const emotionConfig = getEmotionConfig();
      const force = options?.force === true;
      if (!emotionConfig?.enabled) {
        return { message: '', state: null };
      }
      if (!force && (!emotionConfig.injectToSystemPrompt || !emotionConfig.realtimeAnalysis)) {
        return { message: '', state: null };
      }

      const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
      const trimmed = content.trim();
      if (!trimmed) return { message: '', state: null };

      const minSampleCount = Math.max(1, Math.floor(emotionConfig.minSampleCount || 1));
      if (!normalizedThreadId && minSampleCount > 1) {
        return { message: '', state: null };
      }

      if (normalizedThreadId) {
        const thread = chatThreadDb.getChatThread(normalizedThreadId);
        if (thread?.is_incognito) return { message: '', state: null };
      }

      const emotion = normalizedThreadId
        ? await analyzeRealtimeEmotion(normalizedThreadId, trimmed)
        : await analyzeEmotionWithAgent(trimmed);
      if (!emotion) return { message: '', state: null };

      const realtimeSample = {
        emotion: {
          label: emotion.label,
          confidence: emotion.confidence,
          ...(typeof emotion.valence === 'number' ? { valence: emotion.valence } : {}),
          ...(typeof emotion.arousal === 'number' ? { arousal: emotion.arousal } : {}),
          ...(emotion.emotions ? { emotions: emotion.emotions } : {}),
        },
        timestamp: new Date(),
      };

      const fetchLimit = Math.max(
        10,
        Math.floor(emotionConfig.windowSize || 0) * 3,
        minSampleCount
      );
      const samples = [realtimeSample];

      if (normalizedThreadId) {
        const events = emotionDb.listEmotionEvents(normalizedThreadId, fetchLimit);
        samples.push(...collectEmotionSamples(events));
      }

      let affectState = computeAffectState(samples, emotionConfig);
      if (!affectState && normalizedThreadId && canStoreShortMemory()) {
        const shortEntries = memoryDb.listShortMemory(normalizedThreadId, fetchLimit);
        affectState = computeAffectState(
          [realtimeSample, ...collectEmotionSamples(shortEntries)],
          emotionConfig
        );
      }

      if (!affectState) return { message: '', state: null };
      return {
        message: buildAffectSystemMessage(affectState),
        state: affectState,
      };
    } catch (error) {
      chatMemoryLogger.event({
        level: 'warn',
        event: 'chat.memory.realtime_affect_context',
        outcome: 'failed',
        error,
        entity: {
          thread_id: typeof threadId === 'string' ? threadId : null,
        },
        data: {
          error_message: getErrorMessage(error),
        },
      });
      return { message: '', state: null };
    }
  };

  const computeAffectStateForThread = (threadId: string) => {
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled) return null;
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

    return affectState;
  };

  const persistAffectState = (threadId: string) => {
    const affectState = computeAffectStateForThread(threadId);
    if (!affectState) {
      affectDb.deleteAffectState(threadId);
      return;
    }
    affectDb.upsertAffectState(threadId, affectState);
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

      await memoryDb.addLongMemory(
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

  const queueEmotionAnalysis = (params: {
    threadId: string;
    messageId: string;
    messageJson: string;
  }): Promise<void> => {
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled) return Promise.resolve();
    const thread = chatThreadDb.getChatThread(params.threadId);
    if (thread?.is_incognito) return Promise.resolve();
    const inFlight = emotionAnalysisInFlight.get(params.messageId);
    if (inFlight) return inFlight;

    const extracted = memoryDb.extractTextFromMessageJson(params.messageJson);
    if (!extracted || extracted.role !== 'user') return Promise.resolve();

    const content = extracted.content.trim();
    if (!content) return Promise.resolve();

    const promise = (async () => {
      try {
        const cachedEmotion = consumeRealtimeEmotion(params.threadId, content);
        const textEmotion = cachedEmotion ?? (await analyzeRealtimeEmotion(params.threadId, content));

        const audioEmotion = extractAudioEmotionFromMessageJson(params.messageJson);
        const emotion = audioEmotion
          ? mergeAudioEmotionWithTextEmotion(audioEmotion, textEmotion)
          : textEmotion;
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

        persistAffectState(params.threadId);
      } catch (error) {
        chatMemoryLogger.event({
          level: 'warn',
          event: 'chat.memory.emotion_analysis',
          outcome: 'failed',
          error,
          entity: {
            thread_id: params.threadId,
            message_id: params.messageId,
          },
          data: {
            error_message: getErrorMessage(error),
          },
        });
      } finally {
        emotionAnalysisInFlight.delete(params.messageId);
      }
    })();

    emotionAnalysisInFlight.set(params.messageId, promise);
    return promise;
  };

  const buildMemoryPreview = (entry: {
    id: string;
    summary: string;
    score: number;
    updated_at?: string;
    tags?: string | null;
    source_message_ids?: string | null;
  }): MemoryPreview => ({
    id: entry.id,
    summary: entry.summary,
    score: entry.score,
    updated_at: entry.updated_at,
    tags: parseJsonStringArray(entry.tags),
    sourceMessageCount: parseJsonStringArray(entry.source_message_ids).length || undefined,
  });

  const resolveMemorySearchQuery = async (
    query: string
  ): Promise<{ shouldSearch: boolean; query: string }> => {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        shouldSearch: false,
        query: '',
      };
    }

    try {
      const plan = await planMemoryRetrieval(trimmed);
      if (!plan) {
        return {
          shouldSearch: true,
          query: trimmed,
        };
      }

      if (!plan.shouldSearch) {
        return {
          shouldSearch: false,
          query: '',
        };
      }

      const plannedQuery = plan.query.trim();
      return {
        shouldSearch: true,
        query: plannedQuery || trimmed,
      };
    } catch (error) {
      chatMemoryLogger.event({
        level: 'warn',
        event: 'chat.memory.retrieval_plan',
        outcome: 'failed',
        error,
        data: {
          error_message: getErrorMessage(error),
        },
      });
      return {
        shouldSearch: true,
        query: trimmed,
      };
    }
  };

  const retrieveRelevantMemory = async (
    threadId: string,
    query: string
  ): Promise<MemoryRetrievalPayload | null> => {
    if (!threadId || !query.trim()) return null;
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.enabled) return null;

    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return null;

    const searchPlan = await resolveMemorySearchQuery(query);
    if (!searchPlan.shouldSearch || !searchPlan.query) return null;

    const limit = Math.max(1, Math.trunc(memoryConfig.maxRetrievalCount || 0));
    const threshold = memoryConfig.similarThreshold;
    const threadResults = await memoryDb.searchLongMemory(threadId, searchPlan.query, {
      limit,
      threshold,
    });
    const clientResults = thread?.client_id
      ? await memoryDb.searchLongMemoryAcrossThreads(searchPlan.query, {
          limit: Math.max(limit * 2, limit),
          threshold,
          clientId: thread.client_id,
        })
      : [];

    const combined = [...threadResults, ...clientResults];
    const deduped: typeof combined = [];
    const seen = new Set<string>();

    for (const entry of combined) {
      if (!entry?.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      deduped.push(entry);
      if (deduped.length >= limit) break;
    }

    return {
      query: searchPlan.query,
      results: deduped.map(buildMemoryPreview),
      systemMessage: deduped.length > 0 ? buildMemorySystemMessage(deduped) : '',
    };
  };

  const injectMemoryIntoMessages = async (
    messages: ChatInputMessage[],
    threadId?: string,
    options?: {
      onRetrieved?: (payload: MemoryRetrievalPayload) => void;
      skipRetrieval?: boolean;
      skipAffect?: boolean;
    }
  ): Promise<ChatInputMessage[]> => {
    if (!threadId) return messages;
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return messages;

    const systemMessages: ChatInputMessage[] = [];
    const lastMessage = messages[messages.length - 1];
    const query = getPromptFromMessage(lastMessage);
    const memoryPayload =
      options?.skipRetrieval || !query.trim() ? null : await retrieveRelevantMemory(threadId, query);
    if (memoryPayload) {
      if (options?.onRetrieved) {
        options.onRetrieved(memoryPayload);
      }

      if (memoryPayload.systemMessage.trim()) {
        systemMessages.push({ role: 'system', content: memoryPayload.systemMessage });
      }
    }

    if (!options?.skipAffect) {
      const affectContent = getAffectContextMessage(threadId);
      if (affectContent.trim()) {
        systemMessages.push({ role: 'system', content: affectContent });
      }
    }

    if (!systemMessages.length) return messages;

    const insertIndex = messages.findIndex(message => message.role !== 'system');
    const headIndex = insertIndex === -1 ? messages.length : insertIndex;
    return [...messages.slice(0, headIndex), ...systemMessages, ...messages.slice(headIndex)];
  };

  const onMessagePersisted = (params: {
    threadId: string;
    messageId: string;
    messageJson: string;
  }) => {
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

      void queueEmotionAnalysis({
        threadId: params.threadId,
        messageId: params.messageId,
        messageJson: params.messageJson,
      });

      void maybeAutoSummarizeLongMemory(params.threadId, params.messageId, params.messageJson);
    } catch (error) {
      chatMemoryLogger.event({
        level: 'warn',
        event: 'chat.memory.short_memory_upsert',
        outcome: 'failed',
        error,
        entity: {
          thread_id: params.threadId,
          message_id: params.messageId,
        },
        data: {
          error_message: getErrorMessage(error),
        },
      });
    }
  };

  const extractAudioEmotionFromMessageJson = (
    messageJson: string
  ): AudioEmotionResult | null => {
    try {
      const parsed = JSON.parse(messageJson) as {
        metadata?: { audioEmotion?: unknown };
      };
      const audioEmotion = parsed?.metadata?.audioEmotion;
      if (!audioEmotion || typeof audioEmotion !== 'object') return null;
      const ae = audioEmotion as Record<string, unknown>;
      if (
        typeof ae.label !== 'string' ||
        !isAffectLabel(ae.label) ||
        typeof ae.confidence !== 'number'
      ) {
        return null;
      }
      return audioEmotion as AudioEmotionResult;
    } catch {
      return null;
    }
  };

  const mergeAudioEmotionWithTextEmotion = (
    audio: AudioEmotionResult,
    text: EmotionResult | null
  ): EmotionResult | null => {
    if (!text) {
      return {
        label: audio.label,
        confidence: audio.confidence * 0.9,
        ...(typeof audio.valence === 'number' ? { valence: audio.valence } : {}),
        ...(typeof audio.arousal === 'number' ? { arousal: audio.arousal } : {}),
        ...(audio.emotions ? { emotions: audio.emotions } : {}),
        source: 'tool-model',
        providerType: audio.providerType,
        model: audio.model,
        inputChars: 0,
        truncated: false,
      };
    }

    const audioWeight = Math.min(0.7, audio.confidence);
    const textWeight = 1 - audioWeight;

    if (audio.confidence >= 0.7 && audio.label === text.label) {
      return {
        ...text,
        confidence: Math.min(1, text.confidence + 0.1),
        valence:
          typeof audio.valence === 'number'
            ? audio.valence * audioWeight + (text.valence ?? audio.valence) * textWeight
            : text.valence,
        arousal:
          typeof audio.arousal === 'number'
            ? audio.arousal * audioWeight + (text.arousal ?? audio.arousal) * textWeight
            : text.arousal,
      };
    }

    return text;
  };

  const getAffectState = (threadId: string) => computeAffectStateForThread(threadId);

  const waitForEmotionAnalysis = async (params: {
    threadId: string;
    messageId: string;
    messageJson: string;
  }) => {
    await queueEmotionAnalysis(params);
  };

  return {
    injectMemoryIntoMessages,
    onMessagePersisted,
    preloadRealtimeEmotion,
    buildRealtimeAffectContext,
    recordRealtimeEmotion,
    waitForEmotionAnalysis,
    getAffectState,
    getAffectContextMessage,
    retrieveRelevantMemory,
  };
};

export type ChatMemory = ReturnType<typeof createChatMemory>;
