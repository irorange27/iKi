// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import type { Provider } from '../../../src/shared/types/provider';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? '',
  models: overrides.models ?? '[]',
  base_url: overrides.base_url,
  enabled: overrides.enabled ?? true,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  available_models: overrides.available_models ?? '[]',
  api_version: overrides.api_version,
  is_response_api: overrides.is_response_api,
  acp_command: overrides.acp_command,
  acp_args: overrides.acp_args,
  acp_mcp_server_ids: overrides.acp_mcp_server_ids,
  acp_auth_method_id: overrides.acp_auth_method_id,
  acp_api_provider_id: overrides.acp_api_provider_id,
  acp_model_mapping: overrides.acp_model_mapping,
});

const createElectronApi = (options?: {
  providers?: Provider[];
  configured?: boolean;
  thread?: {
    id: string;
    title: string;
    tools?: string | null;
    metadata?: string | null;
    model?: string | null;
    is_incognito?: number;
  } | null;
}) => {
  const stream = vi.fn(async () => ({ success: true }));

  return {
    api: {
      chat: {
        isProviderConfigured: vi.fn(async () => options?.configured ?? true),
        stopStream: vi.fn(async () => ({ success: true })),
        stream,
        threads: {
          get: vi.fn(async () => options?.thread ?? null),
          update: vi.fn(async () => ({})),
        },
      },
      providers: {
        list: vi.fn(async () => options?.providers ?? []),
      },
      tools: {
        list: vi.fn(async () => []),
      },
      speech: {
        getStatus: vi.fn(async () => ({ available: false, enabled: false })),
      },
    },
    stream,
  };
};

const mountChatInput = async (options?: {
  providers?: Provider[];
  configured?: boolean;
  thread?: {
    id: string;
    title: string;
    tools?: string | null;
    metadata?: string | null;
    model?: string | null;
    is_incognito?: number;
  } | null;
  props?: Record<string, unknown>;
}) => {
  const { api, stream } = createElectronApi(options);
  setElectronApi(api);
  vi.resetModules();

  const ChatInput = (await import('../../../src/renderer/components/ChatInput.vue')).default;
  const wrapper = mount(ChatInput, {
    props: {
      chat: {
        messages: [],
      },
      ...options?.props,
    },
    global: {
      stubs: {
        LobeIcon: true,
        SkillSelector: true,
        ToolSelector: true,
      },
    },
  });

  await flushPromises();

  return { wrapper, api, stream };
};

describe('ChatInput', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('filters provider models and emits the selected provider/model pair', async () => {
    const deepseek = buildProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      models: '["deepseek-chat"]',
    });
    const openai = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1","gpt-4o"]',
    });

    const { wrapper } = await mountChatInput({
      providers: [deepseek, openai],
    });

    await wrapper.find('.model-selector-trigger').trigger('click');
    await flushPromises();

    const searchInput = wrapper.find('.model-selector-search-input');
    expect(searchInput.exists()).toBe(true);

    await searchInput.setValue('4o');
    await flushPromises();

    const modelOptions = wrapper.findAll('.model-option');
    expect(modelOptions).toHaveLength(1);
    expect(modelOptions[0].text()).toContain('gpt-4o');

    await modelOptions[0].trigger('click');
    await flushPromises();

    expect(wrapper.find('.model-selector-panel').exists()).toBe(false);
    expect(wrapper.emitted('model-selected')).toEqual([
      [{ provider: openai, model: 'gpt-4o' }],
    ]);
  });

  it('sends the current draft through IPC and appends the unsaved user message to transport data', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, stream } = await mountChatInput({
      providers: [provider],
      props: {
        chat: {
          messages: [
            {
              id: 'assistant_1',
              role: 'assistant',
              parts: [{ type: 'text', text: 'How can I help?' }],
            },
          ],
        },
      },
    });

    await wrapper.find('.chat-input-field').setValue('Need help with the repo');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    const emitted = wrapper.emitted('message-sent');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toBe('Need help with the repo');
    expect(emitted?.[0]?.[1]).toBe('gpt-4.1');

    const onReady = emitted?.[0]?.[4] as (() => void) | undefined;
    expect(typeof onReady).toBe('function');
    onReady?.();
    await flushPromises();

    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4.1',
        tools: undefined,
        mcpServerIds: [],
        skillMode: 'auto',
        skillIds: undefined,
      })
    );

    const streamPayload = stream.mock.calls[0]?.[0];
    expect(streamPayload.messages.at(-1)).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'Need help with the repo' }],
    });
    expect((wrapper.find('.chat-input-field').element as HTMLInputElement).value).toBe('');
  });

  it('restores persisted manual tool selection from the thread and forwards it on send', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, api, stream } = await mountChatInput({
      providers: [provider],
      thread: {
        id: 'thread_1',
        title: 'Docs thread',
        tools: '["web","mcp_lookup"]',
        metadata: JSON.stringify({
          toolSelection: {
            mode: 'manual',
            mcpServerIds: ['docs_server'],
          },
        }),
        model: 'gpt-4.1',
      },
      props: {
        threadId: 'thread_1',
      },
    });

    expect(api.chat.threads.get).toHaveBeenCalledWith('thread_1');

    await wrapper.find('.chat-input-field').setValue('Search the docs');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    const emitted = wrapper.emitted('message-sent');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[2]).toEqual(['web', 'mcp_lookup']);
    expect(emitted?.[0]?.[3]).toEqual(['docs_server']);

    const onReady = emitted?.[0]?.[4] as (() => void) | undefined;
    onReady?.();
    await flushPromises();

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['web', 'mcp_lookup'],
        mcpServerIds: ['docs_server'],
      })
    );
  });

  it('reflects incognito state and emits explicit toggle requests', async () => {
    const { wrapper } = await mountChatInput({
      props: {
        isIncognito: false,
      },
    });

    const modeButton = wrapper.find('.composer-mode-btn');
    expect(modeButton.attributes('aria-pressed')).toBe('false');
    expect(modeButton.attributes('title')).toContain('Memory is enabled');

    await modeButton.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('incognito-changed')).toEqual([[true]]);

    await wrapper.setProps({ isIncognito: true });
    await flushPromises();

    expect(modeButton.classes()).toContain('is-incognito');
    expect(modeButton.attributes('aria-pressed')).toBe('true');
    expect(modeButton.attributes('title')).toContain('Memory is disabled');

    await modeButton.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('incognito-changed')).toEqual([[true], [false]]);
  });
});
