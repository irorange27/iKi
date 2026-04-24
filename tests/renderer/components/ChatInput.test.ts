// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../../src/shared/utils/provider_models';

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
import type { PromptApp, Workspace } from '../../../src/shared/types/chat';
import type { SkillSummary } from '../../../src/shared/types/skill';

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

const buildPromptApp = (
  overrides: Partial<PromptApp> & Pick<PromptApp, 'id' | 'name' | 'prompt_template'>
): PromptApp => ({
  id: overrides.id,
  name: overrides.name,
  description: overrides.description,
  icon: overrides.icon,
  prompt_template: overrides.prompt_template,
  placeholders: overrides.placeholders ?? '[]',
  model: overrides.model,
  enabled: overrides.enabled ?? 1,
  sort_order: overrides.sort_order ?? 0,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  tools: overrides.tools,
  reasoning_effort: overrides.reasoning_effort,
  expects_image_result: overrides.expects_image_result ?? 0,
  is_incognito: overrides.is_incognito ?? 0,
  shortcut: overrides.shortcut,
  window_width: overrides.window_width,
  window_height: overrides.window_height,
  font_size: overrides.font_size,
});

const buildSkill = (
  overrides: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name'>
): SkillSummary => ({
  id: overrides.id,
  name: overrides.name,
  description: overrides.description ?? '',
  source: overrides.source ?? 'codex',
  requiredTools: overrides.requiredTools,
  path: overrides.path,
});

const createElectronApi = (options?: {
  providers?: Provider[];
  modelCatalogByProviderId?: Record<
    string,
    Array<{
      id: string;
      displayName?: string;
      maxInputTokens?: number | null;
      maxOutputTokens?: number | null;
      contextWindow?: number | null;
    }>
  >;
  workspaces?: Workspace[];
  pickedWorkspace?: Workspace | null;
  skills?: SkillSummary[];
  promptApps?: PromptApp[];
  configured?: boolean;
  configuredError?: Error;
  thread?: {
    id: string;
    title: string;
    tools?: string | null;
    metadata?: string | null;
    model?: string | null;
    is_incognito?: number;
    prompt_app_id?: string;
  } | null;
}) => {
  const stream = vi.fn(async () => ({ success: true }));
  const onProvidersUpdated = vi.fn();
  const removeProviderListener = vi.fn();

  return {
    api: {
      chat: {
        getModels: vi.fn(async (providerType: string, providerId?: string) => {
          if (providerId && options?.modelCatalogByProviderId?.[providerId]) {
            return options.modelCatalogByProviderId[providerId];
          }

          return (options?.providers ?? [])
            .filter(provider => provider.type === providerType)
            .flatMap(provider =>
              JSON.parse(provider.models || '[]').map((model: string) => ({
                id: model,
                displayName: model,
              }))
            );
        }),
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
      promptApps: {
        getEnabled: vi.fn(async () => options?.promptApps ?? []),
      },
      skills: {
        list: vi.fn(async () => options?.skills ?? []),
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
  modelCatalogByProviderId?: Record<
    string,
    Array<{
      id: string;
      displayName?: string;
      maxInputTokens?: number | null;
      maxOutputTokens?: number | null;
      contextWindow?: number | null;
    }>
  >;
  configured?: boolean;
  configuredError?: Error;
  skills?: SkillSummary[];
  promptApps?: PromptApp[];
  thread?: {
    id: string;
    title: string;
    tools?: string | null;
    metadata?: string | null;
    model?: string | null;
    is_incognito?: number;
    prompt_app_id?: string;
  } | null;
  messages?: unknown[];
  prepareMessageSend?: (payload: {
    content: string;
    model?: string;
    providerId?: string;
    tools?: string[];
    mcpServerIds?: string[];
    promptAppId?: string;
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
      promptAppId?: string;
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

  it('renders the thread todo plan above the composer shell and hides it when absent', async () => {
    const activePlan = {
      thread_id: 'thread_1',
      items: [
        { id: '1', text: 'Inspect state', status: 'completed' },
        { id: '2', text: 'Ship composer card', status: 'in_progress' },
        { id: '3', text: 'Task three', status: 'pending' },
        { id: '4', text: 'Task four', status: 'pending' },
        { id: '5', text: 'Task five', status: 'pending' },
        { id: '6', text: 'Task six', status: 'pending' },
      ],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:01:00.000Z',
    };

    const { wrapper } = await mountChatInput({
      props: {
        todoPlan: activePlan,
      },
    });

    const plan = wrapper.find('.chat-input-plan');
    const composer = wrapper.find('.chat-input-container');

    expect(plan.exists()).toBe(true);
    expect(plan.text()).toContain('1 out of 6 tasks completed');
    expect(plan.text()).toContain('Ship composer card');
    expect(plan.text()).toContain('Task five');
    expect(plan.text()).not.toContain('Task six');
    expect(
      plan.element.compareDocumentPosition(composer.element) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await wrapper.setProps({ todoPlan: null });
    await flushPromises();

    expect(wrapper.find('.chat-input-plan').exists()).toBe(false);
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

  it('shows built-in slash command suggestions as soon as the user types slash', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, prepareMessageSend } = await mountChatInput({
      providers: [provider],
    });

    await wrapper.find('.chat-input-field').setValue('/');
    await flushPromises();

    const menu = wrapper.find('.slash-command-menu');
    expect(menu.exists()).toBe(true);
    expect(menu.text()).toContain('/new');
    expect(menu.text()).toContain('/clear');
    expect(menu.text()).toContain('/incognito');

    await wrapper.find('.chat-input-field').trigger('keydown.enter', { key: 'Enter' });
    await flushPromises();

    const chip = wrapper.find('.composer-inline-token--command');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain('/new');
    expect((wrapper.find('.chat-input-field').element as HTMLInputElement).value).toBe('');
    expect(prepareMessageSend).not.toHaveBeenCalled();
  });

  it('shows skills as compact slash commands and routes requests through manual skill selection', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const frontendSkill = buildSkill({
      id: 'codex:frontend-dev',
      name: 'frontend-dev',
      description: 'Premium frontend page building',
      source: 'codex',
      path: '/Users/nina/.codex/minimax-skills/skills/frontend-dev/SKILL.md',
    });

    const { wrapper, prepareMessageSend, stream } = await mountChatInput({
      providers: [provider],
      skills: [frontendSkill],
    });

    await wrapper.find('.chat-input-field').setValue('/front');
    await flushPromises();

    const menu = wrapper.find('.slash-command-menu');
    expect(menu.exists()).toBe(true);
    expect(menu.text()).toContain('Skills');
    expect(menu.text()).toContain('/frontend-dev');
    expect(menu.text()).toContain('/Users/nina/.codex/minimax-skills/skills/frontend-dev/SKILL.md');

    await wrapper.find('.chat-input-field').trigger('keydown.enter', { key: 'Enter' });
    await flushPromises();

    const slashChip = wrapper.find('.composer-inline-token--skill');
    expect(slashChip.exists()).toBe(true);
    expect(slashChip.text()).toContain('$frontend-dev');
    expect((wrapper.find('.chat-input-field').element as HTMLInputElement).value).toBe('');

    await wrapper.find('.chat-input-field').setValue('build a landing page');
    await flushPromises();

    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(prepareMessageSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'build a landing page',
      })
    );
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        skillMode: 'manual',
        skillIds: ['codex:frontend-dev'],
      })
    );
  });

  it('shows selected skills as a dedicated composer context and lets the user clear them inline', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const frontendSkill = buildSkill({
      id: 'codex:frontend-dev',
      name: 'frontend-dev',
      description: 'Premium frontend page building',
      source: 'codex',
      path: '/Users/nina/.codex/minimax-skills/skills/frontend-dev/SKILL.md',
    });

    const { wrapper } = await mountChatInput({
      providers: [provider],
      skills: [frontendSkill],
    });

    wrapper
      .findComponent({ name: 'SkillSelector' })
      .vm.$emit('update:skillIds', ['codex:frontend-dev']);
    wrapper.findComponent({ name: 'SkillSelector' }).vm.$emit('update:mode', 'manual');
    await flushPromises();

    const selectedSkillChip = wrapper.find('.composer-inline-token--skill');
    expect(selectedSkillChip.exists()).toBe(true);
    expect(selectedSkillChip.text()).toContain('$frontend-dev');
    expect(wrapper.find('.chat-input-field').attributes('placeholder') ?? '').toContain(
      'selected skills'
    );

    await selectedSkillChip.trigger('click');
    await flushPromises();

    expect(wrapper.find('.composer-inline-token--skill').exists()).toBe(false);
  });

  it('clears active invocation and selected skills with backspace when the draft is empty', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const frontendSkill = buildSkill({
      id: 'codex:frontend-dev',
      name: 'frontend-dev',
      description: 'Premium frontend page building',
      source: 'codex',
      path: '/Users/nina/.codex/minimax-skills/skills/frontend-dev/SKILL.md',
    });

    const { wrapper } = await mountChatInput({
      providers: [provider],
      skills: [frontendSkill],
    });

    await wrapper.find('.chat-input-field').setValue('/front');
    await flushPromises();
    await wrapper.find('.chat-input-field').trigger('keydown.enter', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.find('.composer-inline-token--skill').text()).toContain('$frontend-dev');

    await wrapper.find('.chat-input-field').trigger('keydown', { key: 'Backspace' });
    await flushPromises();

    expect(wrapper.find('.composer-inline-token--skill').exists()).toBe(false);

    wrapper
      .findComponent({ name: 'SkillSelector' })
      .vm.$emit('update:skillIds', ['codex:frontend-dev']);
    wrapper.findComponent({ name: 'SkillSelector' }).vm.$emit('update:mode', 'manual');
    await flushPromises();

    expect(wrapper.find('.composer-inline-token--skill').text()).toContain('$frontend-dev');

    await wrapper.find('.chat-input-field').trigger('keydown', { key: 'Backspace' });
    await flushPromises();

    expect(wrapper.find('.composer-inline-token--skill').exists()).toBe(false);
  });

  it('executes the built-in new-chat slash command locally without streaming', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, prepareMessageSend, stream } = await mountChatInput({
      providers: [provider],
    });

    await wrapper.find('.chat-input-field').setValue('/new');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('new-chat-requested')).toEqual([[]]);
    expect(prepareMessageSend).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(wrapper.find('.composer-feedback-message').text()).toContain('Started a new chat');
  });

  it('executes the built-in clear slash command as a fresh-task reset without streaming', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, prepareMessageSend, stream } = await mountChatInput({
      providers: [provider],
    });

    await wrapper.find('.chat-input-field').setValue('/clear');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('clear-thread-requested')).toEqual([[]]);
    expect(prepareMessageSend).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(wrapper.find('.composer-feedback-message').text()).toContain(
      'Cleared the current thread context'
    );
    expect(wrapper.find('.chat-input-container .composer-feedback').exists()).toBe(true);
  });

  it('executes a selected built-in clear invocation even when the draft is empty', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, prepareMessageSend, stream } = await mountChatInput({
      providers: [provider],
    });

    await wrapper.find('.chat-input-field').setValue('/clear');
    await flushPromises();

    await wrapper.find('.chat-input-field').trigger('keydown.enter', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.find('.composer-inline-token--command').text()).toContain('/clear');
    expect((wrapper.find('.chat-input-field').element as HTMLInputElement).value).toBe('');

    await wrapper.find('.chat-input-field').trigger('keydown.enter', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.emitted('clear-thread-requested')).toEqual([[]]);
    expect(prepareMessageSend).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(wrapper.find('.composer-feedback-message').text()).toContain(
      'Cleared the current thread context'
    );
  });

  it('lets the user dismiss composer feedback inline', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper } = await mountChatInput({
      providers: [provider],
    });

    await wrapper.find('.chat-input-field').setValue('/clear');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.chat-input-container .composer-feedback').exists()).toBe(true);

    await wrapper.find('.composer-feedback-dismiss').trigger('click');
    await flushPromises();

    expect(wrapper.find('.composer-feedback').exists()).toBe(false);
  });

  it('executes the built-in incognito slash command locally without streaming', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, prepareMessageSend, stream } = await mountChatInput({
      providers: [provider],
      props: {
        isIncognito: false,
      },
    });

    await wrapper.find('.chat-input-field').setValue('/incognito on');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('incognito-changed')).toEqual([[true]]);
    expect(prepareMessageSend).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(wrapper.find('.composer-feedback-message').text()).toContain(
      'Incognito mode is now enabled'
    );
  });

  it('shows selected prompt shortcuts as plain labels inside the composer token', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const musicPrompt = buildPromptApp({
      id: 'prompt_music',
      name: 'Music',
      shortcut: 'music',
      prompt_template: 'Compose music for:\n{{input}}',
    });

    const { wrapper } = await mountChatInput({
      providers: [provider],
      promptApps: [musicPrompt],
    });

    await wrapper.find('.chat-input-field').setValue('/mus');
    await flushPromises();
    await wrapper.find('.chat-input-field').trigger('keydown.enter', { key: 'Enter' });
    await flushPromises();

    const promptChip = wrapper.find('.composer-inline-token--prompt');
    expect(promptChip.exists()).toBe(true);
    expect(promptChip.text()).toContain('music');
    expect(promptChip.text()).not.toContain('/music');
  });

  it('expands slash commands through prompt templates before preparing the send payload', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const summarizePrompt = buildPromptApp({
      id: 'prompt_summarize',
      name: 'Summarize',
      shortcut: 'summarize',
      prompt_template: 'Summarize carefully:\n{{input}}',
    });

    const { wrapper, prepareMessageSend, stream } = await mountChatInput({
      providers: [provider],
      promptApps: [summarizePrompt],
    });

    await wrapper.find('.chat-input-field').setValue('/summarize Release notes draft');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(prepareMessageSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Summarize carefully:\nRelease notes draft',
        promptAppId: 'prompt_summarize',
      })
    );
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: 'user',
            parts: [{ type: 'text', text: 'Summarize carefully:\nRelease notes draft' }],
          }),
        ],
      })
    );
  });

  it('uses the selected model capability as the context denominator and forwards it with the stream payload', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, stream } = await mountChatInput({
      providers: [provider],
      modelCatalogByProviderId: {
        openai: [
          {
            id: 'gpt-4.1',
            displayName: 'GPT-4.1',
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            contextWindow: 128000,
          },
        ],
      },
      props: {
        latestTokenUsage: {
          inputTokens: 1200,
          outputTokens: 90,
          totalTokens: 1290,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          reasoningTokens: null,
          estimatedCostUsd: null,
          maxInputTokens: null,
          maxOutputTokens: null,
          model: 'gpt-4.1',
          providerType: 'openai',
          providerId: 'openai',
        },
      },
    });

    expect(wrapper.find('.composer-context-value').text()).toBe('1%');

    await wrapper.find('.chat-input-field').setValue('Need help with the repo');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        providerId: 'openai',
        model: 'gpt-4.1',
        modelCapability: {
          contextWindow: 128000,
          maxInputTokens: 128000,
          maxOutputTokens: 16384,
        },
      })
    );
  });

  it('falls back to the shared 128k context denominator when model metadata is unavailable', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, stream } = await mountChatInput({
      providers: [provider],
      props: {
        latestTokenUsage: {
          inputTokens: 1200,
          outputTokens: 90,
          totalTokens: 1290,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          reasoningTokens: null,
          estimatedCostUsd: null,
          maxInputTokens: null,
          maxOutputTokens: null,
          model: 'gpt-4.1',
          providerType: 'openai',
          providerId: 'openai',
        },
      },
    });

    expect(wrapper.find('.composer-context-value').text()).toBe('1%');

    await wrapper.find('.chat-input-field').setValue('Use the default limit');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        providerId: 'openai',
        model: 'gpt-4.1',
        modelCapability: {
          contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
          maxInputTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
        },
      })
    );
  });

  it('exposes a programmatic replace-draft-and-send helper for history actions', async () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const { wrapper, stream, prepareMessageSend } = await mountChatInput({
      providers: [provider],
    });

    const exposed = wrapper.vm as unknown as {
      replaceDraftMessageAndSend: (
        text: string,
        options?: { focus?: boolean; select?: boolean }
      ) => Promise<void>;
    };

    await exposed.replaceDraftMessageAndSend('Replay this prompt', { focus: true });
    await flushPromises();

    expect(prepareMessageSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Replay this prompt',
        model: 'gpt-4.1',
        providerId: 'openai',
      })
    );
    expect(stream).toHaveBeenCalledTimes(1);
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
    expect(wrapper.find('.composer-feedback-message').text()).toBe(
      'Failed to verify the OpenAI provider configuration. Please try again.'
    );
    expect((wrapper.find('.chat-input-field').element as HTMLInputElement).value).toBe(
      'Need help with the repo'
    );
  });
});
