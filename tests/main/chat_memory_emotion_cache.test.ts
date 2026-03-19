import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/config', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('../../src/core/db/chat_thread', () => ({
  getChatThread: vi.fn(),
}));

vi.mock('../../src/core/db/memory', () => ({
  extractTextFromMessageJson: vi.fn(),
  addShortMemoryFromChatMessage: vi.fn(),
  pruneShortMemory: vi.fn(),
  listLongMemory: vi.fn(() => []),
  listShortMemory: vi.fn(() => []),
  addLongMemory: vi.fn(),
}));

vi.mock('../../src/core/db/emotion', () => ({
  addEmotionEvent: vi.fn(),
  pruneEmotionEvents: vi.fn(),
  listEmotionEvents: vi.fn(() => []),
}));

vi.mock('../../src/core/db/affect_state', () => ({
  upsertAffectState: vi.fn(),
  deleteAffectState: vi.fn(),
  getAffectState: vi.fn(() => null),
}));

vi.mock('../../src/core/provider/emotion_model', () => ({
  analyzeEmotionWithAgent: vi.fn(),
}));

import { getAppConfig } from '../../src/core/config';
import { getChatThread } from '../../src/core/db/chat_thread';
import * as memoryDb from '../../src/core/db/memory';
import * as emotionDb from '../../src/core/db/emotion';
import { analyzeEmotionWithAgent } from '../../src/core/provider/emotion_model';
import { createChatMemory } from '../../src/main/services/chat/chat_memory';

const getAppConfigMock = vi.mocked(getAppConfig);
const getChatThreadMock = vi.mocked(getChatThread);
const analyzeEmotionMock = vi.mocked(analyzeEmotionWithAgent);

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue({
    memory: {
      enabled: false,
      autoSummarize: false,
      maxRetrievalCount: 5,
      similarThreshold: 0.1,
      emotion: {
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
    },
  } as any);
  getChatThreadMock.mockReturnValue({ is_incognito: false } as any);
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
});
