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
  searchLongMemory: vi.fn(() => []),
  searchLongMemoryAcrossThreads: vi.fn(() => []),
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
import { createChatMemory } from '../../src/main/services/chat/chat_memory';

const getAppConfigMock = vi.mocked(getAppConfig);
const getChatThreadMock = vi.mocked(getChatThread);

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue({
    memory: {
      enabled: true,
      autoSummarize: false,
      maxRetrievalCount: 5,
      similarThreshold: 0.1,
      context: {
        enabled: true,
      },
      emotion: {
        enabled: false,
        injectToSystemPrompt: false,
        realtimeAnalysis: false,
      },
    },
  } as ReturnType<typeof getAppConfig>);
  getChatThreadMock.mockReturnValue({
    is_incognito: false,
    client_id: 'client_1',
  } as ReturnType<typeof getChatThread>);
});

describe('chat_memory retrieval scope', () => {
  it('prefers thread-local results before same-client cross-thread results and deduplicates ids', async () => {
    vi.mocked(memoryDb.searchLongMemory).mockReturnValue([
      {
        id: 'mem_thread',
        thread_id: 'thread_1',
        summary: 'Local constraint',
        embedding: '[]',
        source_message_ids: '[]',
        emotion: null,
        tags: null,
        metadata: null,
        created_at: '',
        updated_at: '',
        score: 0.91,
      },
    ]);
    vi.mocked(memoryDb.searchLongMemoryAcrossThreads).mockReturnValue([
      {
        id: 'mem_thread',
        thread_id: 'thread_1',
        summary: 'Local constraint',
        embedding: '[]',
        source_message_ids: '[]',
        emotion: null,
        tags: null,
        metadata: null,
        created_at: '',
        updated_at: '',
        score: 0.91,
      },
      {
        id: 'mem_client',
        thread_id: 'thread_9',
        summary: 'Same client preference',
        embedding: '[]',
        source_message_ids: '[]',
        emotion: null,
        tags: null,
        metadata: null,
        created_at: '',
        updated_at: '',
        score: 0.77,
      },
    ]);

    const memory = createChatMemory();
    const payload = await memory.retrieveRelevantMemory('thread_1', 'constraints');

    expect(vi.mocked(memoryDb.searchLongMemory)).toHaveBeenCalledWith(
      'thread_1',
      'constraints',
      expect.objectContaining({ limit: 5, threshold: 0.1 })
    );
    expect(vi.mocked(memoryDb.searchLongMemoryAcrossThreads)).toHaveBeenCalledWith(
      'constraints',
      expect.objectContaining({ clientId: 'client_1' })
    );
    expect(payload?.results.map(entry => entry.id)).toEqual(['mem_thread', 'mem_client']);
  });

  it('does not expand retrieval beyond the active thread when the thread has no client boundary', async () => {
    getChatThreadMock.mockReturnValue({
      is_incognito: false,
      client_id: '',
    } as ReturnType<typeof getChatThread>);
    vi.mocked(memoryDb.searchLongMemory).mockReturnValue([
      {
        id: 'mem_thread_only',
        thread_id: 'thread_2',
        summary: 'Thread-only memory',
        embedding: '[]',
        source_message_ids: '[]',
        emotion: null,
        tags: null,
        metadata: null,
        created_at: '',
        updated_at: '',
        score: 0.88,
      },
    ]);

    const memory = createChatMemory();
    const payload = await memory.retrieveRelevantMemory('thread_2', 'thread only');

    expect(vi.mocked(memoryDb.searchLongMemoryAcrossThreads)).not.toHaveBeenCalled();
    expect(payload?.results.map(entry => entry.id)).toEqual(['mem_thread_only']);
  });
});
