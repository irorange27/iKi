// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import SettingsMemorySection from '../../../packages/desktop/src/renderer/components/settings/SettingsMemorySection.vue';
import { useConfigStore } from '../../../packages/desktop/src/renderer/store/config';
import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import type { ChatThread } from '@iki/backend/types/chat';
import type { Provider } from '@iki/core/types/provider';
import type {
  AffectStateEntry,
  LongMemoryEntry,
  LongMemorySearchResult,
} from '@iki/backend/types/memory';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findButtonByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

const findLabelByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('label')
    .find(label => label.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Label not found: ${text}`);
  }

  return match;
};

const findCardByTitle = (wrapper: VueWrapper, title: string) => {
  const match = wrapper.findAll('.settings-card').find(card => card.find('.card-title').text() === title);

  if (!match) {
    throw new Error(`Card not found: ${title}`);
  }

  return match;
};

const findPanelByHeader = (wrapper: VueWrapper, header: string) => {
  const match = wrapper.findAll('.memory-panel').find(panel => {
    const title = panel.find('.memory-panel-header > span');
    return title.exists() && title.text() === header;
  });

  if (!match) {
    throw new Error(`Panel not found: ${header}`);
  }

  return match;
};

const selectSettingsOption = async (
  wrapper: VueWrapper | DOMWrapper<Element>,
  optionText: string
) => {
  await wrapper.find('.settings-select-trigger').trigger('click');
  await flushPromises();

  const option = wrapper
    .findAll('.settings-select-option')
    .find(candidate => candidate.text().replace(/\s+/g, ' ').includes(optionText));

  if (!option) {
    throw new Error(`Option not found: ${optionText}`);
  }

  await option.trigger('click');
  await flushPromises();
};

const buildThread = (overrides: Partial<ChatThread> & Pick<ChatThread, 'id' | 'title'>): ChatThread => ({
  id: overrides.id,
  title: overrides.title,
  model: overrides.model ?? 'gpt-4.1',
  is_generating: overrides.is_generating ?? false,
  reasoning_effort: overrides.reasoning_effort,
  metadata: overrides.metadata ?? '{}',
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  client_id: overrides.client_id,
  prompt_app_id: overrides.prompt_app_id,
  tools: overrides.tools,
  is_favorited: overrides.is_favorited ?? 0,
  is_incognito: overrides.is_incognito ?? 0,
  workspace_id: overrides.workspace_id,
  enable_artifacts: overrides.enable_artifacts ?? 0,
  artifact_workspace_id: overrides.artifact_workspace_id,
  skill_ids: overrides.skill_ids,
});

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? 'test-key',
  models: overrides.models ?? '[]',
  model_options: overrides.model_options ?? '{}',
  base_url: overrides.base_url ?? '',
  enabled: overrides.enabled ?? true,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  available_models: overrides.available_models ?? '[]',
  api_version: overrides.api_version,
  is_response_api: overrides.is_response_api ?? false,
  acp_command: overrides.acp_command,
  acp_args: overrides.acp_args,
  acp_mcp_server_ids: overrides.acp_mcp_server_ids,
  acp_auth_method_id: overrides.acp_auth_method_id,
  acp_api_provider_id: overrides.acp_api_provider_id,
  acp_model_mapping: overrides.acp_model_mapping,
});

const buildLongMemoryEntry = (
  overrides: Partial<LongMemoryEntry> & Pick<LongMemoryEntry, 'id' | 'thread_id' | 'summary'>
): LongMemoryEntry => ({
  id: overrides.id,
  thread_id: overrides.thread_id,
  summary: overrides.summary,
  embedding: overrides.embedding ?? '[]',
  source_message_ids: overrides.source_message_ids ?? null,
  emotion: overrides.emotion ?? null,
  tags: overrides.tags ?? null,
  metadata: overrides.metadata ?? null,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
});

const buildSearchResult = (
  overrides: Partial<LongMemorySearchResult> &
    Pick<LongMemorySearchResult, 'id' | 'thread_id' | 'summary' | 'score'>
): LongMemorySearchResult => ({
  ...buildLongMemoryEntry(overrides),
  score: overrides.score,
});

const buildAffectStateEntry = (
  overrides?: Partial<AffectStateEntry>
): AffectStateEntry => ({
  thread_id: overrides?.thread_id ?? 'thread_alpha',
  state:
    overrides?.state ??
    JSON.stringify({
      label: 'focused',
      confidence: 0.82,
      valence: 0.18,
      arousal: 0.41,
      sampleCount: 3,
      windowSize: 6,
      startAt: '2026-03-21T07:50:00.000Z',
      endAt: '2026-03-21T08:00:00.000Z',
    }),
  created_at: overrides?.created_at ?? '2026-03-21T08:00:00.000Z',
  updated_at: overrides?.updated_at ?? '2026-03-21T08:00:00.000Z',
});

const mountSettingsMemorySection = async (options?: {
  active?: boolean;
  providers?: Provider[];
  threads?: ChatThread[];
  longEntries?: LongMemoryEntry[];
  allLongEntries?: LongMemoryEntry[];
  searchResults?: LongMemorySearchResult[];
  searchAllResults?: LongMemorySearchResult[];
  affectEntry?: AffectStateEntry | null;
  setupStore?: (store: ReturnType<typeof useConfigStore>) => void;
}) => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const threadsList = vi.fn(async () => options?.threads ?? []);
  const shortList = vi.fn(async () => []);
  const shortListAll = vi.fn(async () => []);
  const longList = vi.fn(async () => options?.longEntries ?? []);
  const longListAll = vi.fn(async () => options?.allLongEntries ?? []);
  const longSearch = vi.fn(async () => options?.searchResults ?? []);
  const longSearchAll = vi.fn(async () => options?.searchAllResults ?? []);
  const longAdd = vi.fn(async () => ({ id: 'long_new' }));
  const longUpdate = vi.fn(async () => ({ success: true }));
  const longDelete = vi.fn(async () => ({ success: true }));
  const affectGet = vi.fn(async () => options?.affectEntry ?? null);

  setElectronApi({
    chat: {
      threads: {
        list: threadsList,
      },
    },
    memory: {
      short: {
        list: shortList,
        add: vi.fn(async () => ({ id: 'short_new' })),
        listAll: shortListAll,
      },
      long: {
        add: longAdd,
        update: longUpdate,
        delete: longDelete,
        list: longList,
        listAll: longListAll,
        search: longSearch,
        searchAll: longSearchAll,
      },
      affect: {
        get: affectGet,
      },
    },
  });

  const store = useConfigStore();
  store.config = createDefaultAppConfig();
  options?.setupStore?.(store);

  const wrapper = mount(SettingsMemorySection, {
    props: {
      active: options?.active ?? true,
      providers: options?.providers ?? [],
    },
    global: {
      plugins: [pinia],
    },
  });

  await flushPromises();

  return {
    wrapper,
    store,
    threadsList,
    shortList,
    shortListAll,
    longList,
    longListAll,
    longSearch,
    longSearchAll,
    longAdd,
    longUpdate,
    longDelete,
    affectGet,
  };
};

describe('SettingsMemorySection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T08:00:00.000Z'));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('updates memory retrieval, context, emotion, and guardrail config through interaction controls', async () => {
    const { wrapper, store } = await mountSettingsMemorySection();

    const retrievalCard = findCardByTitle(wrapper, 'Memory Retrieval');
    await findLabelByText(retrievalCard, 'Enable Memory').find('input').setValue(true);
    await flushPromises();
    await retrievalCard.find('input[type="range"][max="20"]').setValue('7');
    await flushPromises();

    const contextCard = findCardByTitle(wrapper, 'Context Assembly');
    await findLabelByText(contextCard, 'Recent Raw Messages').find('input').setValue('12');
    await flushPromises();

    const emotionCard = findCardByTitle(wrapper, 'Emotion Context');
    expect(store.config.memory.emotion.enabled).toBe(true);
    await emotionCard.find('input[type="range"][max="100"]').setValue('65');
    await flushPromises();

    const guardCard = findCardByTitle(wrapper, 'Tool Guardrails');
    await guardCard.find('input[type="range"][min="-100"][max="0"]').setValue('-35');
    await flushPromises();

    expect(store.config.memory.enabled).toBe(true);
    expect(store.config.memory.maxRetrievalCount).toBe(7);
    expect(store.config.memory.context.recentMessageCount).toBe(12);
    expect(store.config.memory.emotion.enabled).toBe(true);
    expect(store.config.memory.emotion.minConfidence).toBe(0.65);
    expect(store.config.memory.emotion.toolGuard.maxValence).toBe(-0.35);
    expect(wrapper.emitted('config-change')).toHaveLength(5);
  });

  it('stores an explicit embedding model selection in memory settings', async () => {
    const { wrapper, store } = await mountSettingsMemorySection({
      providers: [
        buildProvider({
          id: 'provider_openai',
          name: 'OpenAI Primary',
          type: 'openai',
          models: '["gpt-4.1"]',
        }),
        buildProvider({
          id: 'provider_gateway',
          name: 'Gateway',
          type: 'openai-compatible',
          models: '["custom-embed-large","custom-chat"]',
        }),
      ],
    });

    const embeddingCard = findCardByTitle(wrapper, 'Embedding Model');
    await selectSettingsOption(embeddingCard, 'custom-embed-large');

    expect(store.config.memory.embeddingModel).toEqual({
      providerId: 'provider_gateway',
      providerType: 'openai-compatible',
      model: 'custom-embed-large',
    });
    expect(wrapper.emitted('config-change')).toHaveLength(1);
  });

  it('loads the first thread on activation and hydrates long-memory plus affect-state panels', async () => {
    const { wrapper, threadsList, shortList, longList, affectGet } =
      await mountSettingsMemorySection({
        threads: [buildThread({ id: 'thread_alpha', title: 'Alpha Thread' })],
        longEntries: [
          buildLongMemoryEntry({
            id: 'long_1',
            thread_id: 'thread_alpha',
            summary: 'User prefers concise release notes.',
          }),
        ],
        affectEntry: buildAffectStateEntry(),
        setupStore: store => {
          store.config.memory.emotion.enabled = true;
        },
      });

    expect(threadsList).toHaveBeenCalledTimes(1);
    expect(shortList).not.toHaveBeenCalled();
    expect(longList).toHaveBeenCalledWith('thread_alpha', 25);
    expect(affectGet).toHaveBeenCalledWith('thread_alpha');
    expect(wrapper.text()).toContain('Primary: focused');
    expect(wrapper.text()).toContain('User prefers concise release notes.');
    expect(wrapper.find('.memory-editor .settings-select-trigger').attributes('disabled')).toBeDefined();
  });

  it('searches across all threads with trimmed queries and the current retrieval budget config', async () => {
    const { wrapper, shortListAll, longListAll, longSearchAll, affectGet } =
      await mountSettingsMemorySection({
        threads: [
          buildThread({ id: 'thread_alpha', title: 'Alpha Thread' }),
          buildThread({ id: 'thread_planning', title: 'Planning Thread' }),
        ],
        allLongEntries: [
          buildLongMemoryEntry({
            id: 'long_all_1',
            thread_id: 'thread_planning',
            summary: 'Planning memory summary',
          }),
        ],
        searchAllResults: [
          buildSearchResult({
            id: 'search_1',
            thread_id: 'thread_planning',
            summary: 'Planning memory summary',
            score: 0.912,
            tags: '["planning"]',
          }),
        ],
        setupStore: storeConfig => {
          storeConfig.config.memory.enabled = true;
          storeConfig.config.memory.emotion.enabled = true;
          storeConfig.config.memory.maxRetrievalCount = 7;
          storeConfig.config.memory.similarThreshold = 0.42;
        },
      });

    await selectSettingsOption(wrapper.find('.memory-controls .input-label'), 'All threads');

    expect(shortListAll).not.toHaveBeenCalled();
    expect(longListAll).toHaveBeenCalledWith(25);
    expect(affectGet).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Select a thread to view affect state.');

    await wrapper.find('input[placeholder="Search long memory..."]').setValue('  release notes  ');
    await findButtonByText(wrapper, 'Search').trigger('click');
    await flushPromises();

    expect(longSearchAll).toHaveBeenCalledWith('release notes', {
      limit: 7,
      threshold: 0.42,
      force: true,
    });
    expect(wrapper.text()).toContain('Score 0.912');
    expect(wrapper.text()).toContain('Thread: Planning Thread');
    expect(wrapper.text()).toContain('Tags: planning');
  });

  it('creates a manual long memory with trimmed input and reruns the active search query', async () => {
    const { wrapper, longAdd, longList, longSearch } = await mountSettingsMemorySection({
      threads: [buildThread({ id: 'thread_alpha', title: 'Alpha Thread' })],
      longEntries: [],
    });

    longList.mockResolvedValueOnce([
      buildLongMemoryEntry({
        id: 'long_new',
        thread_id: 'thread_alpha',
        summary: 'Persistent project preference',
      }),
    ]);
    longSearch.mockResolvedValueOnce([
      buildSearchResult({
        id: 'search_new',
        thread_id: 'thread_alpha',
        summary: 'Persistent project preference',
        score: 0.93,
      }),
    ]);

    await wrapper.find('input[placeholder="Search long memory..."]').setValue('  project preference  ');
    await wrapper
      .find('textarea[placeholder="Add a durable user fact, preference, or project detail."]')
      .setValue('  Persistent project preference  ');

    await findButtonByText(wrapper, 'Add Memory').trigger('click');
    await flushPromises();

    expect(longAdd).toHaveBeenCalledTimes(1);
    expect(longAdd).toHaveBeenCalledWith({
      thread_id: 'thread_alpha',
      summary: 'Persistent project preference',
      metadata: {
        source: 'manual',
        createdAt: '2026-03-21T08:00:00.000Z',
      },
    });
    expect(longList).toHaveBeenLastCalledWith('thread_alpha', 25);
    expect(longSearch).toHaveBeenCalledWith('thread_alpha', 'project preference', {
      limit: 5,
      threshold: 0.1,
      force: true,
    });
    expect(
      wrapper.find('textarea[placeholder="Add a durable user fact, preference, or project detail."]').element
        .value
    ).toBe('');
    expect(wrapper.text()).toContain('Persistent project preference');
  });

  it('updates and deletes long memories through the viewer while respecting delete confirmation', async () => {
    const entry = buildLongMemoryEntry({
      id: 'long_existing',
      thread_id: 'thread_alpha',
      summary: 'Original durable memory',
    });

    const { wrapper, longUpdate, longDelete, longList, longSearch } =
      await mountSettingsMemorySection({
        threads: [buildThread({ id: 'thread_alpha', title: 'Alpha Thread' })],
        longEntries: [entry],
      });

    await wrapper.find('input[placeholder="Search long memory..."]').setValue('  durable  ');

    const longPanel = findPanelByHeader(wrapper, 'Long Memory');
    let memoryItem = longPanel.findAll('.memory-item').find(item => item.text().includes(entry.summary));

    if (!memoryItem) {
      throw new Error('Expected long-memory item to exist');
    }

    await findButtonByText(memoryItem, 'Edit').trigger('click');
    await flushPromises();
    await memoryItem.find('textarea').setValue('  Updated durable memory  ');

    longList.mockResolvedValueOnce([
      buildLongMemoryEntry({
        id: 'long_existing',
        thread_id: 'thread_alpha',
        summary: 'Updated durable memory',
      }),
    ]);
    longSearch.mockResolvedValueOnce([
      buildSearchResult({
        id: 'search_updated',
        thread_id: 'thread_alpha',
        summary: 'Updated durable memory',
        score: 0.89,
      }),
    ]);

    await findButtonByText(memoryItem, 'Save').trigger('click');
    await flushPromises();

    expect(longUpdate).toHaveBeenCalledWith('long_existing', {
      summary: 'Updated durable memory',
    });
    expect(longSearch).toHaveBeenCalledWith('thread_alpha', 'durable', {
      limit: 5,
      threshold: 0.1,
      force: true,
    });
    expect(wrapper.text()).toContain('Updated durable memory');

    const confirmSpy = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: confirmSpy,
    });

    memoryItem = findPanelByHeader(wrapper, 'Long Memory')
      .findAll('.memory-item')
      .find(item => item.text().includes('Updated durable memory'));

    if (!memoryItem) {
      throw new Error('Expected updated long-memory item to exist');
    }

    await findButtonByText(memoryItem, 'Delete').trigger('click');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(longDelete).not.toHaveBeenCalled();

    longList.mockResolvedValueOnce([]);
    longSearch.mockResolvedValueOnce([]);

    await findButtonByText(memoryItem, 'Delete').trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(longDelete).toHaveBeenCalledWith('long_existing');
    expect(wrapper.text()).toContain('No long-term memory entries.');
  });
});
