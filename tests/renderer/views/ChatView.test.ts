// @vitest-environment happy-dom

import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

const {
  chatState,
  currentThreadRef,
  currentModelRef,
  isIncognitoRef,
  selectedWorkspaceIdRef,
  selectedToolsRef,
  showWelcomeRef,
  editingUserMessageIdRef,
  streamController,
  setDraftMessageMock,
  handleToolApprovalMock,
  prepareMessageSendMock,
  selectThreadMock,
  handleThreadDeletedMock,
  handleNewChatMock,
  beginEditMessageMock,
  cancelEditingMock,
  setIncognitoMock,
  setWorkspaceMock,
  refreshThreadsMock,
  createNewThreadMock,
  loadToolSourcesMock,
  openSkillReferenceMock,
  getMcpServerLabelMock,
  configStoreState,
  useChatThreadsMock,
  useChatStreamingMock,
  useChatThreadTodoPlanMock,
  useToolMetadataMock,
  useChatViewLifecycleMock,
  useConfigStoreMock,
  getContextReferenceSummaryMock,
  buildContextUsageIndicatorMock,
  createUiMessagePersistenceMock,
  createChatMessageStoreMock,
  handleMarkdownClickMock,
} = vi.hoisted(() => {
  const makeRef = <T>(value: T) => ({ value, __v_isRef: true as const });

  const chatState = {
    messages: [] as UIMessage[],
  };

  const currentThreadRef = makeRef<{
    id: string;
    title: string;
    metadata?: string;
    client_id?: string;
  } | null>(null);
  const currentModelRef = makeRef('gpt-4.1');
  const isIncognitoRef = makeRef(false);
  const selectedWorkspaceIdRef = makeRef<string | null>(null);
  const selectedToolsRef = makeRef<string[]>([]);
  const showWelcomeRef = makeRef(false);
  const editingUserMessageIdRef = makeRef<string | null>(null);

  const streamController = {
    activeAssistantMessageId: makeRef<string | null>(null),
    streamRenderTick: makeRef(0),
    activeAssistantParentId: makeRef<string | null>(null),
    activeStreamThreadId: makeRef<string | null>(null),
    handleUiChunk: vi.fn(async () => undefined),
  };

  const setDraftMessageMock = vi.fn(async () => undefined);
  const handleToolApprovalMock = vi.fn(async () => undefined);
  const prepareMessageSendMock = vi.fn(async () => null);
  const selectThreadMock = vi.fn(async () => undefined);
  const handleThreadDeletedMock = vi.fn(async () => undefined);
  const handleNewChatMock = vi.fn(async () => undefined);
  const beginEditMessageMock = vi.fn(async () => undefined);
  const cancelEditingMock = vi.fn(async () => undefined);
  const setIncognitoMock = vi.fn(async () => undefined);
  const setWorkspaceMock = vi.fn(async () => undefined);
  const refreshThreadsMock = vi.fn(async () => undefined);
  const createNewThreadMock = vi.fn(async () => null);
  const loadToolSourcesMock = vi.fn(async () => undefined);
  const openSkillReferenceMock = vi.fn(async () => undefined);
  const getMcpServerLabelMock = vi.fn(() => 'Docs');
  const handleMarkdownClickMock = vi.fn();
  const configStoreState = {
    initialized: true,
    initialize: vi.fn(async () => undefined),
    config: {
      memory: {
        context: {
          maxTokens: 8192,
        },
      },
    },
  };

  const useChatThreadsMock = vi.fn();
  const useChatStreamingMock = vi.fn();
  const useChatThreadTodoPlanMock = vi.fn();
  const useToolMetadataMock = vi.fn();
  const useChatViewLifecycleMock = vi.fn();
  const useConfigStoreMock = vi.fn(() => configStoreState);
  const getContextReferenceSummaryMock = vi.fn();
  const buildContextUsageIndicatorMock = vi.fn();
  const createUiMessagePersistenceMock = vi.fn(() => ({ resetPersistedMessageIds: vi.fn() }));
  const createChatMessageStoreMock = vi.fn(() => ({
    messages: chatState.messages,
  }));

  return {
    chatState,
    currentThreadRef,
    currentModelRef,
    isIncognitoRef,
    selectedWorkspaceIdRef,
    selectedToolsRef,
    showWelcomeRef,
    editingUserMessageIdRef,
    streamController,
    setDraftMessageMock,
    handleToolApprovalMock,
    prepareMessageSendMock,
    selectThreadMock,
    handleThreadDeletedMock,
    handleNewChatMock,
    beginEditMessageMock,
    cancelEditingMock,
    setIncognitoMock,
    setWorkspaceMock,
    refreshThreadsMock,
    createNewThreadMock,
    loadToolSourcesMock,
    openSkillReferenceMock,
    getMcpServerLabelMock,
    configStoreState,
    useChatThreadsMock,
    useChatStreamingMock,
    useChatThreadTodoPlanMock,
    useToolMetadataMock,
    useChatViewLifecycleMock,
    useConfigStoreMock,
    getContextReferenceSummaryMock,
    buildContextUsageIndicatorMock,
    createUiMessagePersistenceMock,
    createChatMessageStoreMock,
    handleMarkdownClickMock,
  };
});

vi.mock('@ai-sdk/vue', () => ({
  Chat: function Chat() {
    return {
      messages: chatState.messages,
    };
  },
}));

vi.mock('../../../src/renderer/composables/useChatThreads', () => ({
  useChatThreads: useChatThreadsMock,
}));

vi.mock('../../../src/renderer/composables/useChatStreaming', () => ({
  useChatStreaming: useChatStreamingMock,
}));

vi.mock('../../../src/renderer/composables/useChatThreadTodoPlan', () => ({
  useChatThreadTodoPlan: useChatThreadTodoPlanMock,
}));

vi.mock('../../../src/renderer/composables/useToolMetadata', () => ({
  useToolMetadata: useToolMetadataMock,
}));

vi.mock('../../../src/renderer/composables/useChatViewLifecycle', () => ({
  useChatViewLifecycle: useChatViewLifecycleMock,
}));

vi.mock('../../../src/renderer/store/config', () => ({
  useConfigStore: useConfigStoreMock,
}));

vi.mock('../../../src/renderer/composables/useMarkdownCopy', () => ({
  useMarkdownCopy: () => ({
    handleMarkdownClick: handleMarkdownClickMock,
  }),
}));

vi.mock('../../../src/renderer/modules/chat/ui_message_references', () => ({
  getContextReferenceSummary: getContextReferenceSummaryMock,
  buildContextUsageIndicator: buildContextUsageIndicatorMock,
}));

vi.mock('../../../src/renderer/modules/chat/ui_message_persistence', () => ({
  createUiMessagePersistence: createUiMessagePersistenceMock,
}));

vi.mock('../../../src/renderer/modules/chat/chat_message_store', () => ({
  createChatMessageStore: createChatMessageStoreMock,
}));

const SidebarStub = defineComponent({
  name: 'Sidebar',
  emits: ['thread-selected', 'new-chat', 'thread-deleted'],
  setup(_, { emit }) {
    return () =>
      h('div', { class: 'sidebar-stub' }, [
        h('button', {
          class: 'sidebar-select',
          onClick: () => emit('thread-selected', 'thread_2'),
        }),
        h('button', { class: 'sidebar-new', onClick: () => emit('new-chat') }),
      ]);
  },
});

const WelcomeScreenStub = defineComponent({
  name: 'WelcomeScreen',
  emits: ['new-chat'],
  setup(_, { emit }) {
    return () => h('button', { class: 'welcome-screen-stub', onClick: () => emit('new-chat') });
  },
});

const ChatInputStub = defineComponent({
  name: 'ChatInput',
  props: {
    threadId: { type: String, default: '' },
    activeModel: { type: String, default: '' },
    isIncognito: { type: Boolean, default: false },
    selectedWorkspaceId: { type: String, default: null },
    workspaceLocked: { type: Boolean, default: false },
    contextUsage: { type: Object, default: null },
    todoPlan: { type: Object, default: null },
    prepareMessageSend: { type: Function, default: null },
  },
  emits: ['incognito-changed', 'model-selected', 'workspace-changed'],
  setup(_, { expose }) {
    expose({
      setDraftMessage: setDraftMessageMock,
    });
    return () => h('div', { class: 'chat-input-stub' });
  },
});

const ChatMessageItemStub = defineComponent({
  name: 'ChatMessageItem',
  props: {
    message: { type: Object, required: true },
    messageIndex: { type: Number, required: true },
  },
  emits: ['approve-tool', 'edit-user-message', 'open-skill'],
  setup() {
    return () => h('div', { class: 'chat-message-item-stub' });
  },
});

const mountChatView = async () => {
  vi.resetModules();

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {},
  });

  const ChatView = (await import('../../../src/renderer/views/ChatView.vue')).default;
  const wrapper = mount(ChatView, {
    global: {
      stubs: {
        Sidebar: SidebarStub,
        WelcomeScreen: WelcomeScreenStub,
        ChatInput: ChatInputStub,
        ChatMessageItem: ChatMessageItemStub,
        FolderOpen: true,
      },
    },
  });

  await flushPromises();
  return wrapper;
};

describe('ChatView', () => {
  beforeEach(() => {
    chatState.messages = [];
    currentThreadRef.value = { id: 'thread_1', title: 'Thread One' };
    currentModelRef.value = 'gpt-4.1';
    isIncognitoRef.value = false;
    selectedWorkspaceIdRef.value = null;
    selectedToolsRef.value = [];
    showWelcomeRef.value = false;
    editingUserMessageIdRef.value = null;
    streamController.activeAssistantMessageId.value = null;
    streamController.streamRenderTick.value = 0;
    streamController.activeAssistantParentId.value = null;
    streamController.activeStreamThreadId.value = null;

    setDraftMessageMock.mockReset();
    handleToolApprovalMock.mockReset();
    prepareMessageSendMock.mockReset();
    selectThreadMock.mockReset();
    handleThreadDeletedMock.mockReset();
    handleNewChatMock.mockReset();
    beginEditMessageMock.mockReset();
    cancelEditingMock.mockReset();
    configStoreState.initialize.mockReset();
    setIncognitoMock.mockReset();
    setWorkspaceMock.mockReset();
    refreshThreadsMock.mockReset();
    createNewThreadMock.mockReset();
    loadToolSourcesMock.mockReset();
    openSkillReferenceMock.mockReset();
    getMcpServerLabelMock.mockReset();
    useChatThreadsMock.mockReset();
    useChatStreamingMock.mockReset();
    useChatThreadTodoPlanMock.mockReset();
    useToolMetadataMock.mockReset();
    useChatViewLifecycleMock.mockReset();
    getContextReferenceSummaryMock.mockReset();
    buildContextUsageIndicatorMock.mockReset();
    createUiMessagePersistenceMock.mockClear();
    createChatMessageStoreMock.mockClear();
    handleMarkdownClickMock.mockReset();

    useChatThreadsMock.mockImplementation(() => ({
      currentThread: currentThreadRef,
      currentModel: currentModelRef,
      isIncognito: isIncognitoRef,
      selectedWorkspaceId: selectedWorkspaceIdRef,
      selectedTools: selectedToolsRef,
      showWelcome: showWelcomeRef,
      refreshThreads: refreshThreadsMock,
      createNewThread: createNewThreadMock,
      selectThread: vi.fn(async () => undefined),
      handleThreadDeleted: vi.fn(async () => undefined),
      handleNewChat: vi.fn(async () => undefined),
      handleModelSelected: vi.fn(),
      setIncognito: setIncognitoMock,
      setWorkspace: setWorkspaceMock,
      ensureWorkspaceForCurrentThread: vi.fn(async () => currentThreadRef.value),
      getCurrentThreadId: () => currentThreadRef.value?.id ?? null,
      handleAssistantMessagePersisted: vi.fn(async () => undefined),
      handleTaskPush: vi.fn(async () => undefined),
    }));

    useChatStreamingMock.mockImplementation(() => ({
      streamController,
      editingUserMessageId: editingUserMessageIdRef,
      isApprovalProcessing: () => false,
      handleToolApproval: handleToolApprovalMock,
      prepareMessageSend: prepareMessageSendMock,
      beginEditMessage: beginEditMessageMock,
      cancelEditing: cancelEditingMock,
      selectThread: selectThreadMock,
      handleThreadDeleted: handleThreadDeletedMock,
      handleNewChat: handleNewChatMock,
    }));

    useToolMetadataMock.mockImplementation(() => ({
      loadToolSources: loadToolSourcesMock,
      getMcpServerLabel: getMcpServerLabelMock,
      openSkillReference: openSkillReferenceMock,
    }));

    useChatThreadTodoPlanMock.mockImplementation(() => ({
      activeTodoPlan: { value: null, __v_isRef: true as const },
      handleChatChunk: vi.fn(),
      refreshTodoPlan: vi.fn(async () => undefined),
      todoPlan: { value: null, __v_isRef: true as const },
    }));

    getContextReferenceSummaryMock.mockImplementation(() => null);
    buildContextUsageIndicatorMock.mockImplementation(() => null);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
  });

  it('forwards tool approval events from message items into the streaming controller', async () => {
    const assistantMessage: UIMessage = {
      id: 'assistant_1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Need approval' }],
    };
    chatState.messages = [assistantMessage];

    const wrapper = await mountChatView();
    const messageItem = wrapper.findComponent(ChatMessageItemStub);

    await messageItem.vm.$emit('approve-tool', {
      approved: true,
      message: assistantMessage,
      part: { approval: { id: 'approval_1' } },
    });
    await flushPromises();

    expect(handleToolApprovalMock).toHaveBeenCalledWith(
      assistantMessage,
      { approval: { id: 'approval_1' } },
      true
    );
  });

  it('routes edit requests back into the composer draft setter', async () => {
    const userMessage: UIMessage = {
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'Edit me' }],
    };
    chatState.messages = [userMessage];
    beginEditMessageMock.mockImplementation(
      async (_message: UIMessage, setDraft: (text: string) => Promise<void>) => {
        await setDraft('Edited from history');
      }
    );

    const wrapper = await mountChatView();
    const messageItem = wrapper.findComponent(ChatMessageItemStub);

    await messageItem.vm.$emit('edit-user-message', userMessage);
    await flushPromises();

    expect(beginEditMessageMock).toHaveBeenCalledWith(userMessage, expect.any(Function));
    expect(setDraftMessageMock).toHaveBeenCalledWith('Edited from history', {
      focus: true,
      select: true,
    });
  });

  it('clears the composer draft when edit mode is cancelled', async () => {
    editingUserMessageIdRef.value = 'user_1';
    cancelEditingMock.mockImplementation(async (clearDraft: () => Promise<void>) => {
      await clearDraft();
    });

    const wrapper = await mountChatView();

    expect(wrapper.find('.edit-banner').exists()).toBe(true);

    await wrapper.find('.edit-banner-cancel').trigger('click');
    await flushPromises();

    expect(cancelEditingMock).toHaveBeenCalledWith(expect.any(Function));
    expect(setDraftMessageMock).toHaveBeenCalledWith('', { focus: true });
  });

  it('passes the latest assistant context usage summary down to the composer', async () => {
    chatState.messages = [
      {
        id: 'assistant_old',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Old context' }],
      },
      {
        id: 'assistant_latest',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Latest context' }],
      },
    ];

    getContextReferenceSummaryMock.mockImplementation((message: UIMessage) =>
      message.id === 'assistant_latest' ? { retainedRecentMessages: 3 } : null
    );
    buildContextUsageIndicatorMock.mockImplementation(summary =>
      summary ? { label: '3 kept', tone: 'neutral' } : null
    );

    const wrapper = await mountChatView();
    const chatInput = wrapper.findComponent(ChatInputStub);

    expect(chatInput.props('contextUsage')).toEqual({
      label: '3 kept',
      tone: 'neutral',
    });
  });

  it('passes the active thread todo plan down to the composer region', async () => {
    const activePlan = {
      thread_id: 'thread_1',
      items: [
        { id: '1', text: 'Inspect state', status: 'completed' as const },
        { id: '2', text: 'Implement UI card', status: 'in_progress' as const },
      ],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:01:00.000Z',
    };

    useChatThreadTodoPlanMock.mockImplementation(() => ({
      activeTodoPlan: { value: activePlan, __v_isRef: true as const },
      handleChatChunk: vi.fn(),
      refreshTodoPlan: vi.fn(async () => undefined),
      todoPlan: { value: activePlan, __v_isRef: true as const },
    }));

    const wrapper = await mountChatView();
    const chatInput = wrapper.findComponent(ChatInputStub);

    expect(chatInput.props('todoPlan')).toEqual(activePlan);
  });

  it('locks workspace switching once the selected thread already has messages', async () => {
    chatState.messages = [
      {
        id: 'user_1',
        role: 'user',
        parts: [{ type: 'text', text: 'First turn' }],
      },
    ];

    const wrapper = await mountChatView();
    const chatInput = wrapper.findComponent(ChatInputStub);

    expect(chatInput.props('workspaceLocked')).toBe(true);
  });

  it('shows an external-thread control-plane notice when viewing bridge-owned chats', async () => {
    currentThreadRef.value = {
      id: 'napcat_10001_private_20002',
      title: 'QQ User 20002',
      client_id: 'client_napcat',
      metadata: JSON.stringify({ source: 'napcat', message_type: 'private' }),
    };
    chatState.messages = [
      {
        id: 'assistant_external',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello from QQ' }],
      },
    ];

    const wrapper = await mountChatView();

    expect(wrapper.find('.thread-origin-chip').exists()).toBe(true);
    expect(wrapper.find('.thread-origin-chip').text()).toContain('QQ private');
    expect(wrapper.find('.thread-origin-banner').text()).toContain(
      'Viewing QQ private in the desktop control plane.'
    );
    expect(wrapper.find('.thread-origin-banner').text()).toContain(
      'not delivered back to the external channel'
    );
  });
});
