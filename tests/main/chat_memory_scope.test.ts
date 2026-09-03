import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  searchLongMemory: vi.fn(() => []),
  searchLongMemoryAcrossThreads: vi.fn(() => []),
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

vi.mock('@iki/backend/provider/memory_retrieval', () => ({
  planMemoryRetrieval: vi.fn(),
}));

import { getAppConfig } from '@iki/backend/config';
import { getChatThread } from '@iki/backend/db/chat_thread';
import * as memoryDb from '@iki/backend/db/memory';
import { planMemoryRetrieval } from '@iki/backend/provider/memory_retrieval';
import { createChatMemory } from '@iki/backend/thread_session/memory';

const getAppConfigMock = vi.mocked(getAppConfig);
const getChatThreadMock = vi.mocked(getChatThread);
const planMemoryRetrievalMock = vi.mocked(planMemoryRetrieval);

beforeEach(() => {
  vi.clearAllMocks();
  planMemoryRetrievalMock.mockResolvedValue(null);
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

  it('rewrites the retrieval query before searching long memory', async () => {
    planMemoryRetrievalMock.mockResolvedValue({
      shouldSearch: true,
      query: 'durable project constraints',
      source: 'tool-model',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      inputChars: 19,
      truncated: false,
    });
    vi.mocked(memoryDb.searchLongMemory).mockReturnValue([
      {
        id: 'mem_thread',
        thread_id: 'thread_1',
        summary: 'Rewritten query hit',
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

    const memory = createChatMemory();
    const payload = await memory.retrieveRelevantMemory('thread_1', 'what are the constraints?');

    expect(vi.mocked(memoryDb.searchLongMemory)).toHaveBeenCalledWith(
      'thread_1',
      'durable project constraints',
      expect.objectContaining({ limit: 5, threshold: 0.1 })
    );
    expect(vi.mocked(memoryDb.searchLongMemoryAcrossThreads)).toHaveBeenCalledWith(
      'durable project constraints',
      expect.objectContaining({ clientId: 'client_1' })
    );
    expect(payload?.query).toBe('durable project constraints');
  });

  it('skips retrieval entirely when the planner decides memory is irrelevant', async () => {
    planMemoryRetrievalMock.mockResolvedValue({
      shouldSearch: false,
      query: '',
      source: 'tool-model',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      inputChars: 5,
      truncated: false,
    });

    const memory = createChatMemory();
    const payload = await memory.retrieveRelevantMemory('thread_1', 'thanks');

    expect(payload).toBeNull();
    expect(vi.mocked(memoryDb.searchLongMemory)).not.toHaveBeenCalled();
    expect(vi.mocked(memoryDb.searchLongMemoryAcrossThreads)).not.toHaveBeenCalled();
  });

  it('falls back to the raw query when retrieval planning fails', async () => {
    planMemoryRetrievalMock.mockRejectedValue(new Error('planner unavailable'));
    vi.mocked(memoryDb.searchLongMemory).mockReturnValue([
      {
        id: 'mem_thread',
        thread_id: 'thread_1',
        summary: 'Raw query hit',
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

    const memory = createChatMemory();
    const payload = await memory.retrieveRelevantMemory('thread_1', 'raw fallback');

    expect(vi.mocked(memoryDb.searchLongMemory)).toHaveBeenCalledWith(
      'thread_1',
      'raw fallback',
      expect.objectContaining({ limit: 5, threshold: 0.1 })
    );
    expect(payload?.query).toBe('raw fallback');
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
