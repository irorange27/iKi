// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('../../../src/renderer/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import type { Provider } from '../../../src/shared/types/provider';
import type { Workspace } from '../../../src/shared/types/chat';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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

const buildWorkspace = (
  overrides: Partial<Workspace> & Pick<Workspace, 'id' | 'name' | 'path'>
): Workspace => ({
  id: overrides.id,
  name: overrides.name,
  path: overrides.path,
  is_temporary: overrides.is_temporary ?? 0,
  show_in_list: overrides.show_in_list ?? 1,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
});

const createElectronApi = (options?: {
  providers?: Provider[];
  workspaces?: Workspace[];
  pickedWorkspace?: Workspace | null;
  configured?: boolean;
  configuredError?: Error;
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
  const onProvidersUpdated = vi.fn();
  const removeProviderListener = vi.fn();

  return {
    api: {
      chat: {
        isProviderConfigured: vi.fn(async () => {
          if (options?.configuredError) {
            throw options.configuredError;
          }
          return options?.configured ?? true;
        }),
        stopStream: vi.fn(async () => ({ success: true })),
        stream,
        threads: {
          get: vi.fn(async () => options?.thread ?? null),
          update: vi.fn(async () => ({})),
        },
      },
      providers: {
        list: vi.fn(async () => options?.providers ?? []),
        onUpdated: vi.fn((callback: unknown) => {
          onProvidersUpdated(callback);
          return removeProviderListener;
        }),
      },
      workspaces: {
        getVisible: vi.fn(async () => options?.workspaces ?? []),
        get: vi.fn(
          async (id: string) =>
            (options?.workspaces ?? []).find(workspace => workspace.id === id) ?? null
        ),
        pickDirectory: vi.fn(async () => options?.pickedWorkspace ?? null),
      },
      tools: {
        list: vi.fn(async () => []),
      },
      speech: {
        getStatus: vi.fn(async () => ({ available: false, enabled: false })),
      },
    },
    stream,
    onProvidersUpdated,
    removeProviderListener,
  };
};

const mountChatInput = async (options?: {
  providers?: Provider[];
  configured?: boolean;
  configuredError?: Error;
  thread?: {
    id: string;
    title: string;
    tools?: string | null;
    metadata?: string | null;
    model?: string | null;
    is_incognito?: number;
  } | null;
  messages?: unknown[];
  prepareMessageSend?: (payload: {
    content: string;
    model?: string;
    providerId?: string;
    tools?: string[];
    mcpServerIds?: string[];
  }) => Promise<{
    threadId: string;
    messagesSnapshot: unknown[];
  } | null>;
  props?: Record<string, unknown>;
}) => {
  const { api, stream, onProvidersUpdated, removeProviderListener } = createElectronApi(options);
  setElectronApi(api);
  vi.resetModules();

  const prepareMessageSend = vi.fn(
    async (payload: {
      content: string;
      model?: string;
      providerId?: string;
      tools?: string[];
      mcpServerIds?: string[];
    }) => {
      if (options?.prepareMessageSend) {
        return await options.prepareMessageSend(payload);
      }

      const baseMessages = Array.isArray(options?.messages) ? options.messages : [];
      return {
        threadId:
          options?.thread?.id ||
          (typeof options?.props?.threadId === 'string'
            ? options.props.threadId
            : 'thread_prepared'),
        messagesSnapshot: [
          ...baseMessages,
          {
            id: `user_${baseMessages.length + 1}`,
            role: 'user',
            parts: [{ type: 'text', text: payload.content }],
          },
        ],
      };
    }
  );

  const mountProps = { ...(options?.props ?? {}) };
  delete mountProps.chat;

  const ChatInput = (await import('../../../src/renderer/components/ChatInput.vue')).default;
  const wrapper = mount(ChatInput, {
    props: {
      ...mountProps,
      prepareMessageSend,
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

  return {
    wrapper,
    api,
    stream,
    prepareMessageSend,
    onProvidersUpdated,
    removeProviderListener,
  };
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
    expect(wrapper.emitted('model-selected')).toEqual([[{ provider: openai, model: 'gpt-4o' }]]);
  });

  it('aligns the composer selection with the active thread model before send', async () => {
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

    const { wrapper, stream, prepareMessageSend } = await mountChatInput({
      providers: [deepseek, openai],
      thread: {
        id: 'thread_1',
        title: 'Existing thread',
        model: 'gpt-4o',
      },
      props: {
        threadId: 'thread_1',
        activeModel: 'gpt-4o',
      },
    });

    await wrapper.find('.chat-input-field').setValue('Use the saved model');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(prepareMessageSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Use the saved model',
        model: 'gpt-4o',
        providerId: 'openai',
      })
    );

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        providerId: 'openai',
        model: 'gpt-4o',
      })
    );
  });

  it('reloads providers when the renderer receives a provider update broadcast', async () => {
    const initialProvider = buildProvider({
      id: 'provider-openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4o-mini"]',
    });
    const addedProvider = buildProvider({
      id: 'provider-custom',
      name: 'Custom Gateway',
      type: 'openai-compatible',
      models: '["my-model"]',
    });

    const { wrapper, api, onProvidersUpdated, removeProviderListener } = await mountChatInput({
      providers: [initialProvider],
    });

    expect(api.providers.list).toHaveBeenCalledTimes(1);
    expect(onProvidersUpdated).toHaveBeenCalledTimes(1);

    const providerUpdateHandler = onProvidersUpdated.mock.calls[0]?.[0];
    if (typeof providerUpdateHandler !== 'function') {
      throw new Error('provider update handler was not registered');
    }

    vi.mocked(api.providers.list).mockResolvedValueOnce([initialProvider, addedProvider]);
    await providerUpdateHandler({
      action: 'added',
      providerId: addedProvider.id,
    });
    await flushPromises();

    expect(api.providers.list).toHaveBeenCalledTimes(2);

    await wrapper.find('.model-selector-trigger').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.model-provider-group')).toHaveLength(2);
    expect(wrapper.text()).toContain('Custom Gateway');

    wrapper.unmount();

    expect(removeProviderListener).toHaveBeenCalledTimes(1);
  });

  it('sends the current draft through IPC and appends the unsaved user message to transport data', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, stream, prepareMessageSend } = await mountChatInput({
      providers: [provider],
      messages: [
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'How can I help?' }],
        },
      ],
    });

    await wrapper.find('.chat-input-field').setValue('Need help with the repo');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(prepareMessageSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Need help with the repo',
        model: 'gpt-4.1',
        providerId: 'openai',
        tools: [],
        mcpServerIds: [],
      })
    );

    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        providerId: 'openai',
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

    const { wrapper, api, stream, prepareMessageSend } = await mountChatInput({
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

    expect(prepareMessageSend).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['web', 'mcp_lookup'],
        mcpServerIds: ['docs_server'],
      })
    );

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

  it('shows the selected workspace and emits explicit workspace change requests', async () => {
    const docsWorkspace = buildWorkspace({
      id: 'workspace_docs',
      name: 'Docs',
      path: '/tmp/docs',
    });
    const appWorkspace = buildWorkspace({
      id: 'workspace_app',
      name: 'App',
      path: '/tmp/app',
    });

    const { wrapper } = await mountChatInput({
      workspaces: [docsWorkspace, appWorkspace],
      props: {
        selectedWorkspaceId: 'workspace_docs',
      },
    });

    const workspaceTrigger = wrapper.find('.workspace-selector-trigger');
    expect(workspaceTrigger.exists()).toBe(true);
    expect(workspaceTrigger.attributes('title')).toContain('Docs');
    expect(workspaceTrigger.classes()).toContain('w-10');
    expect(workspaceTrigger.find('.selector-badge').text()).toBe('1');

    await workspaceTrigger.trigger('click');
    await flushPromises();

    const workspaceItems = wrapper.findAll('.selector-item');
    const appOption = workspaceItems.find(option => option.text().includes('App'));
    expect(appOption).toBeDefined();
    if (!appOption) {
      throw new Error('Expected App workspace option to be rendered');
    }

    await appOption.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('workspace-changed')).toEqual([['workspace_app']]);
  });

  it('marks temporary workspaces with a T badge on the composer trigger', async () => {
    const tempWorkspace = buildWorkspace({
      id: 'workspace_thread_1',
      name: 'Thread Scratch',
      path: '/tmp/thread-1',
      is_temporary: 1,
      show_in_list: 0,
    });

    const { wrapper } = await mountChatInput({
      workspaces: [tempWorkspace],
      props: {
        selectedWorkspaceId: 'workspace_thread_1',
      },
    });

    const workspaceTrigger = wrapper.find('.workspace-selector-trigger');
    expect(workspaceTrigger.find('.selector-badge').text()).toBe('T');
    expect(workspaceTrigger.attributes('title')).toContain('Temporary workspace');
  });

  it('disables workspace switching once the thread workspace is locked', async () => {
    const docsWorkspace = buildWorkspace({
      id: 'workspace_docs',
      name: 'Docs',
      path: '/tmp/docs',
    });

    const { wrapper } = await mountChatInput({
      workspaces: [docsWorkspace],
      props: {
        selectedWorkspaceId: 'workspace_docs',
        workspaceLocked: true,
      },
    });

    const workspaceTrigger = wrapper.find('.workspace-selector-trigger');
    expect(workspaceTrigger.attributes('disabled')).toBeDefined();
    expect(workspaceTrigger.attributes('title')).toContain('locked');

    await workspaceTrigger.trigger('click');
    await flushPromises();

    expect(wrapper.find('.workspace-selector-panel').exists()).toBe(false);
    expect(wrapper.emitted('workspace-changed')).toBeUndefined();
  });

  it('shows a rich workspace tip for locked temporary workspace bindings', async () => {
    const tempWorkspace = buildWorkspace({
      id: 'workspace_thread_1',
      name: 'Temp Workspace',
      path: '/tmp/thread-1',
      is_temporary: 1,
      show_in_list: 0,
    });

    const { wrapper } = await mountChatInput({
      workspaces: [tempWorkspace],
      props: {
        selectedWorkspaceId: 'workspace_thread_1',
        workspaceLocked: true,
      },
    });

    await wrapper.find('.workspace-selector-root').trigger('mouseenter');
    await flushPromises();

    const tip = wrapper.find('.workspace-selector-tip');
    expect(tip.exists()).toBe(true);
    expect(tip.text()).toContain('Temp Workspace');
    expect(tip.text()).toContain('/tmp/thread-1');
    expect(tip.text()).toContain('(Temp)');
    expect(tip.text()).toContain('Hidden from global list');
    expect(tip.text()).toContain('Workspace cannot be changed after sending messages');
  });

  it('uses the same accent visual state as the other selector buttons when workspaces are available', async () => {
    const docsWorkspace = buildWorkspace({
      id: 'workspace_docs',
      name: 'Docs',
      path: '/tmp/docs',
    });

    const { wrapper } = await mountChatInput({
      workspaces: [docsWorkspace],
    });

    const workspaceTrigger = wrapper.find('.workspace-selector-trigger');
    expect(workspaceTrigger.classes()).toContain('ui-text-accent');
  });

  it('can add a workspace directly from the workspace selector panel', async () => {
    const pickedWorkspace = buildWorkspace({
      id: 'workspace_new',
      name: 'Repo',
      path: '/tmp/repo',
    });

    const { wrapper, api } = await mountChatInput({
      workspaces: [],
      pickedWorkspace,
    });

    await wrapper.find('.workspace-selector-trigger').trigger('click');
    await flushPromises();

    const addFolderButton = wrapper
      .findAll('button')
      .find(button => button.text().includes('Add Folder'));
    expect(addFolderButton).toBeDefined();
    if (!addFolderButton) {
      throw new Error('Expected Add Folder button to be rendered');
    }

    await addFolderButton.trigger('click');
    await flushPromises();

    expect(api.workspaces.pickDirectory).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('workspace-changed')).toEqual([['workspace_new']]);
  });

  it('waits for the send-preparation promise before starting IPC streaming', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });
    const deferred = createDeferred<{
      threadId: string;
      messagesSnapshot: unknown[];
    }>();

    const { wrapper, stream, prepareMessageSend } = await mountChatInput({
      providers: [provider],
      prepareMessageSend: () => deferred.promise,
      props: {
        threadId: 'thread_1',
      },
    });

    await wrapper.find('.chat-input-field').setValue('Wait until prepared');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(prepareMessageSend).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();

    deferred.resolve({
      threadId: 'thread_1',
      messagesSnapshot: [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Wait until prepared' }],
        },
      ],
    });
    await flushPromises();

    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('surfaces inline feedback and aborts send when provider verification throws', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });
    const configuredError = new Error('ipc failed');

    const { wrapper, stream, prepareMessageSend } = await mountChatInput({
      providers: [provider],
      configuredError,
    });

    await wrapper.find('.chat-input-field').setValue('Need help with the repo');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(prepareMessageSend).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'chat.provider.verify',
        outcome: 'failed',
        error: configuredError,
      })
    );
    expect(wrapper.find('.composer-feedback').text()).toBe(
      'Failed to verify the OpenAI provider configuration. Please try again.'
    );
    expect((wrapper.find('.chat-input-field').element as HTMLInputElement).value).toBe(
      'Need help with the repo'
    );
  });
});
