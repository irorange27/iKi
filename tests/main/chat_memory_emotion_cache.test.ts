import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import type { ChatThread } from '@iki/backend/types/chat';

vi.mock('@iki/backend/config', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: vi.fn(),
}));

vi.mock('@iki/backend/db/memory', () => ({
  extractTextFromMessageJson: vi.fn(),
  addShortMemoryFromChatMessage: vi.fn(),
  pruneShortMemory: vi.fn(),
  listLongMemory: vi.fn(() => []),
  listShortMemory: vi.fn(() => []),
  addLongMemory: vi.fn(),
}));

vi.mock('@iki/backend/db/emotion', () => ({
  addEmotionEvent: vi.fn(),
  pruneEmotionEvents: vi.fn(),
  listEmotionEvents: vi.fn(() => []),
}));

vi.mock('@iki/backend/db/affect_state', () => ({
  upsertAffectState: vi.fn(),
  deleteAffectState: vi.fn(),
  getAffectState: vi.fn(() => null),
}));

vi.mock('@iki/backend/provider/emotion_model', () => ({
  analyzeEmotionWithAgent: vi.fn(),
}));

import { getAppConfig } from '@iki/backend/config';
import { getChatThread } from '@iki/backend/db/chat_thread';
import * as memoryDb from '@iki/backend/db/memory';
import * as emotionDb from '@iki/backend/db/emotion';
import { analyzeEmotionWithAgent } from '@iki/backend/provider/emotion_model';
import { createChatMemory } from '@iki/backend/thread_session/memory';

const getAppConfigMock = vi.mocked(getAppConfig);
const getChatThreadMock = vi.mocked(getChatThread);
const analyzeEmotionMock = vi.mocked(analyzeEmotionWithAgent);

const createThread = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: 'thread_1',
  title: 'Thread 1',
  is_generating: false,
  metadata: '{}',
  created_at: '2026-03-18T00:00:00.000Z',
  updated_at: '2026-03-18T00:00:00.000Z',
  is_favorited: 0,
  is_incognito: 0,
  enable_artifacts: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  const config = createDefaultAppConfig();
  config.memory = {
    ...config.memory,
    enabled: false,
    autoSummarize: false,
    maxRetrievalCount: 5,
    similarThreshold: 0.1,
    emotion: {
      ...config.memory.emotion,
      enabled: true,
      injectToSystemPrompt: true,
      realtimeAnalysis: true,
      minConfidence: 0,
      minSampleCount: 1,
      windowSize: 3,
      halfLifeMinutes: 60,
      maxAgeMinutes: 180,
      includeNeutral: false,
    },
  };
  getAppConfigMock.mockReturnValue(config);
  getChatThreadMock.mockReturnValue(createThread({ is_incognito: 0 }));
  vi.mocked(memoryDb.extractTextFromMessageJson).mockReturnValue({
    role: 'user',
    content: 'Hello there',
  });
});

describe('chat_memory realtime emotion cache', () => {
  it('uses cached realtime emotion during persistence to avoid duplicate analysis', async () => {
    const memory = createChatMemory();
    const cachedEmotion = { label: 'joy', confidence: 0.9 };

    memory.recordRealtimeEmotion('thread_1', 'Hello there', cachedEmotion);
    memory.onMessagePersisted({
      threadId: 'thread_1',
      messageId: 'msg_1',
      messageJson: JSON.stringify({ role: 'user', content: 'Hello there' }),
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(analyzeEmotionMock).not.toHaveBeenCalled();
    expect(emotionDb.addEmotionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_1',
        message_id: 'msg_1',
        emotion: cachedEmotion,
      })
    );
  });

  it('shares a preloaded realtime emotion analysis with persistence', async () => {
    const memory = createChatMemory();
    const resolvedEmotion = { label: 'sadness', confidence: 0.84 };
    let resolveAnalysis: ((value: typeof resolvedEmotion) => void) | null = null;

    analyzeEmotionMock.mockReturnValue(
      new Promise(resolve => {
        resolveAnalysis = resolve;
      })
    );

    memory.preloadRealtimeEmotion('thread_1', 'Hello there');
    memory.onMessagePersisted({
      threadId: 'thread_1',
      messageId: 'msg_2',
      messageJson: JSON.stringify({ role: 'user', content: 'Hello there' }),
    });

    expect(analyzeEmotionMock).toHaveBeenCalledTimes(1);

    resolveAnalysis?.(resolvedEmotion);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(analyzeEmotionMock).toHaveBeenCalledTimes(1);
    expect(emotionDb.addEmotionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_1',
        message_id: 'msg_2',
        emotion: resolvedEmotion,
      })
    );
  });

  it('builds same-turn affect context from realtime analysis when requested', async () => {
    const memory = createChatMemory();
    analyzeEmotionMock.mockResolvedValue({
      label: 'anger',
      confidence: 0.86,
      valence: -0.62,
      arousal: 0.79,
      emotions: [{ label: 'anger', score: 0.86 }],
    } as never);

    const affectContext = await memory.buildRealtimeAffectContext('thread_1', 'Hello there');

    expect(analyzeEmotionMock).toHaveBeenCalledWith('Hello there');
    expect(affectContext.message).not.toBe('');
    expect(affectContext.state).toEqual(
      expect.objectContaining({
        label: 'anger',
        confidence: expect.any(Number),
        valence: expect.any(Number),
        arousal: expect.any(Number),
      })
    );
  });

  it('can force same-turn affect analysis for experiments even when realtime analysis is disabled in config', async () => {
    const config = createDefaultAppConfig();
    config.memory = {
      ...config.memory,
      enabled: false,
      autoSummarize: false,
      maxRetrievalCount: 5,
      similarThreshold: 0.1,
      emotion: {
        ...config.memory.emotion,
        enabled: true,
        injectToSystemPrompt: false,
        realtimeAnalysis: false,
        minConfidence: 0,
        minSampleCount: 1,
        windowSize: 3,
        halfLifeMinutes: 60,
        maxAgeMinutes: 180,
        includeNeutral: false,
      },
    };
    getAppConfigMock.mockReturnValue(config);

    const memory = createChatMemory();
    analyzeEmotionMock.mockResolvedValue({
      label: 'sadness',
      confidence: 0.8,
      valence: -0.63,
      arousal: 0.61,
      emotions: [{ label: 'sadness', score: 0.8 }],
    } as never);

    const affectContext = await memory.buildRealtimeAffectContext('thread_1', 'Hello there', {
      force: true,
    });

    expect(analyzeEmotionMock).toHaveBeenCalledWith('Hello there');
    expect(affectContext.state).toEqual(
      expect.objectContaining({
        label: 'sadness',
      })
    );
  });
});
