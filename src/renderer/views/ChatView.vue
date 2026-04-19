<template>
  <div class="flex h-full min-h-0 app-background app-text">
    <Sidebar
      ref="sidebarRef"
      @thread-selected="selectThread"
      @new-chat="handleNewChat"
      @thread-deleted="handleThreadDeleted"
    />

    <!-- Main Content -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Header -->
      <div v-if="showHeaderMeta" class="flex items-center justify-center p-4">
        <div class="ui-text-secondary flex items-center gap-1 text-sm">
          <span v-if="showMessageCount">{{ t('chat.messagesCount', { count: chatMessages.length }) }}</span>
          <span v-if="showMessageCount && currentThread">·</span>
          <FolderOpen v-if="currentThread" :size="12" />
          <span v-if="currentThread">{{ currentThread.title }}</span>
          <span v-if="currentThreadOrigin?.isExternal" class="thread-origin-chip">
            {{ currentThreadOrigin.channelLabel || currentThreadOrigin.sourceLabel || 'External' }}
          </span>
        </div>
      </div>

      <!-- Main Area -->
      <div
        class="chat-main-area ui-scrollbar flex min-h-0 min-w-0 flex-1 overflow-y-auto"
        :class="showWelcomeScreen ? 'chat-main-area-welcome' : 'items-center justify-center'"
        ref="messagesContainer"
      >
        <WelcomeScreen
          v-if="showWelcomeScreen"
          :active-model="currentModel"
          :active-provider-id="currentProviderId"
          @compose-starter="handleComposeStarter"
        />

        <!-- Messages List -->
        <div v-else class="messages-area w-full h-full min-w-0">
          <div
            v-if="visibleOnboardingBanner"
            class="onboarding-banner"
            role="status"
            aria-live="polite"
          >
            <div class="onboarding-banner-topline">
              <span class="onboarding-banner-label">{{ t('chat.onboarding.banner.label') }}</span>
              <button
                class="onboarding-banner-dismiss"
                type="button"
                :aria-label="t('common.close')"
                @click="dismissOnboardingBanner"
              >
                <X :size="14" />
              </button>
            </div>
            <div class="onboarding-banner-copy">
              <strong>{{ visibleOnboardingBanner.title }}</strong>
              <span>{{ visibleOnboardingBanner.body }}</span>
            </div>
          </div>
          <div v-if="externalThreadNotice" class="thread-origin-banner">
            {{ externalThreadNotice }}
          </div>
          <div class="messages-container" @click="handleMarkdownClick">
            <ChatMessageItem
              v-for="(m, index) in chatMessages"
              :key="m.id ? m.id : index"
              :message="m"
              :message-index="index"
              :active-assistant-message-id="streamController.activeAssistantMessageId.value"
              :stream-render-tick="streamController.streamRenderTick.value"
              :approval-processing="isApprovalProcessing"
              :get-mcp-server-label="getMcpServerLabel"
              @approve-tool="handleToolApprovalEvent"
              @regenerate-user-message="regenerateMessage"
              @edit-user-message="beginEditMessage"
            />
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <div class="composer-area">
        <div v-if="editingUserMessageId" class="edit-banner">
          <div class="edit-banner-text">
            <strong>{{ t('chat.editingBanner.title') }}</strong>
            {{ t('chat.editingBanner.body') }}
          </div>
          <button class="edit-banner-cancel" type="button" @click="cancelEditing">
            {{ t('common.cancel') }}
          </button>
        </div>
        <ChatInput
          ref="chatInputRef"
          :thread-id="currentThread?.id || ''"
          :active-model="currentModel"
          :active-provider-id="currentProviderId"
          :is-incognito="isIncognito"
          :selected-workspace-id="selectedWorkspaceId"
          :workspace-locked="isWorkspaceLocked"
          :latest-token-usage="latestAssistantTokenUsage"
          :todo-plan="activeTodoPlan"
          :prepare-message-send="prepareMessageSend"
          @incognito-changed="handleIncognitoChanged"
          @model-selected="handleModelSelected"
          @workspace-changed="handleWorkspaceChanged"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { computed, ref, nextTick } from 'vue';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import { FolderOpen, X } from 'lucide-vue-next';
import { useI18n } from '../i18n';
import { getTokenUsageSummary } from '../modules/chat/ui_message_references';
import { createUiMessagePersistence } from '../modules/chat/ui_message_persistence';
import { createChatMessageStore } from '../modules/chat/chat_message_store';
import { createPrefixedId } from '../../shared/utils/id';
import { useChatViewLifecycle } from '../composables/useChatViewLifecycle';
import { useConfigStore } from '../store/config';
import { useMarkdownCopy } from '../composables/useMarkdownCopy';
import { useChatThreads } from '../composables/useChatThreads';
import { useChatStreaming } from '../composables/useChatStreaming';
import { useChatThreadTodoPlan } from '../composables/useChatThreadTodoPlan';
import { useToolMetadata } from '../composables/useToolMetadata';
import { getThreadOriginInfo } from '../modules/chat/thread_origin';
import { getElectronAPI } from '../services/electron_api';
import type { ChatUiMessage } from '../../shared/chat/message_parts';

type ChatInputExpose = {
  setDraftMessage: (
    text: string,
    options?: { focus?: boolean; select?: boolean }
  ) => Promise<void> | void;
  replaceDraftMessageAndSend: (
    text: string,
    options?: { focus?: boolean; select?: boolean }
  ) => Promise<void> | void;
};

const electronAPI = getElectronAPI();
const { t } = useI18n();

const configStore = useConfigStore();
const preferredDraftModel = computed(() => configStore.config.chat.composer.preferredModel);
const preferredDraftProviderId = computed(
  () => configStore.config.chat.composer.preferredProviderId
);

const persistDraftModelSelection = async (selection: {
  model: string;
  providerId: string | null;
}) => {
  if (!configStore.initialized) {
    await configStore.initialize();
  }

  const preferredModel = selection.model.trim();
  const preferredProviderId = typeof selection.providerId === 'string' ? selection.providerId : '';
  const currentSelection = configStore.config.chat.composer;
  if (
    currentSelection.preferredModel === preferredModel &&
    currentSelection.preferredProviderId === preferredProviderId
  ) {
    return;
  }

  configStore.setChatComposerSelection({
    preferredModel,
    preferredProviderId,
  });
  await configStore.saveConfig();
};

// Create Chat instance for message management (without API endpoint for Electron)
const chat = new Chat<ChatUiMessage>({});
const chatMessages = computed<ChatUiMessage[]>(() => chat.messages);
const messagesContainer = ref<HTMLElement | null>(null);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const chatInputRef = ref<ChatInputExpose | null>(null);
const dismissedOnboardingStageKey = ref<string | null>(null);
const persistence = createUiMessagePersistence({ electronAPI });
const messageStore = createChatMessageStore(chat);
const { handleMarkdownClick } = useMarkdownCopy();

const createMessageId = () => createPrefixedId('msg');
const { loadToolSources, getMcpServerLabel } = useToolMetadata({
  electronAPI,
});

const latestAssistantTokenUsage = computed(() => {
  const messages = Array.isArray(chat.messages) ? [...chat.messages] : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;

    const summary = getTokenUsageSummary(message);
    if (summary && summary.inputTokens !== null) return summary;
  }

  return null;
});

const showMessageCount = computed(() => chatMessages.value.length > 0);
const showHeaderMeta = computed(() => showMessageCount.value || Boolean(currentThread.value));
const showWelcomeScreen = computed(() => showWelcome.value && chatMessages.value.length === 0);

const userMessageCount = computed(
  () => chatMessages.value.filter(message => message?.role === 'user').length
);
const assistantMessageCount = computed(
  () => chatMessages.value.filter(message => message?.role === 'assistant').length
);

const onboardingBannerStageKey = computed<string | null>(() => {
  if (showWelcome.value || currentThreadOrigin.value?.isExternal) return null;
  if (userMessageCount.value !== 1) return null;
  return assistantMessageCount.value === 0 ? 'sent' : 'started';
});

const onboardingBanner = computed<null | { title: string; body: string }>(() => {
  if (!onboardingBannerStageKey.value) return null;

  if (onboardingBannerStageKey.value === 'sent') {
    return {
      title: t('chat.onboarding.banner.sent.title'),
      body: t('chat.onboarding.banner.sent.body'),
    };
  }

  return {
    title: t('chat.onboarding.banner.started.title'),
    body: t('chat.onboarding.banner.started.body'),
  };
});

const visibleOnboardingBanner = computed<null | { title: string; body: string }>(() => {
  if (!onboardingBanner.value) return null;
  if (
    onboardingBannerStageKey.value &&
    dismissedOnboardingStageKey.value === onboardingBannerStageKey.value
  ) {
    return null;
  }
  return onboardingBanner.value;
});

const currentThreadOrigin = computed(() =>
  currentThread.value ? getThreadOriginInfo(currentThread.value) : null
);

const externalThreadNotice = computed(() => {
  const origin = currentThreadOrigin.value;
  if (!origin?.isExternal) return '';

  const channelLabel =
    origin.channelLabel || origin.sourceLabel || t('chat.external.defaultChannelLabel');
  return t('chat.external.notice', { channel: channelLabel });
});

const isWorkspaceLocked = computed(
  () => Boolean(currentThread.value?.id) && chatMessages.value.length > 0
);

const handleToolApprovalEvent = (payload: {
  approved: boolean;
  message: ChatUiMessage;
  part: unknown;
}) => {
  void handleToolApproval(payload.message, payload.part, payload.approved);
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const {
  currentThread,
  currentModel,
  currentProviderId,
  isIncognito,
  selectedWorkspaceId,
  selectedTools,
  showWelcome,
  refreshThreads,
  createNewThread,
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
  handleModelSelected,
  setIncognito,
  setWorkspace,
  ensureWorkspaceForCurrentThread,
  getCurrentThreadId,
  handleAssistantMessagePersisted,
  handleTaskPush,
} = useChatThreads({
  electronAPI,
  messageStore,
  persistence,
  sidebarRef,
  scrollToBottom,
  preferredDraftModel,
  preferredDraftProviderId,
  persistDraftModelSelection,
});

const handleIncognitoChanged = async (nextValue: boolean) => {
  await setIncognito(nextValue);
};

const handleWorkspaceChanged = async (nextValue: string | null) => {
  await setWorkspace(nextValue);
};

const { activeTodoPlan, handleChatChunk } = useChatThreadTodoPlan({
  electronAPI,
  threadId: computed(() => currentThread.value?.id || null),
});

const streaming = useChatStreaming({
  electronAPI,
  messageStore,
  persistence,
  createMessageId,
  scrollToBottom,
  getCurrentThreadId,
  onAssistantMessagePersisted: handleAssistantMessagePersisted,
  currentThread,
  currentModel,
  selectedTools,
  showWelcome,
  createNewThread,
  ensureWorkspaceForCurrentThread,
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
});

const streamController = streaming.streamController;
const editingUserMessageId = streaming.editingUserMessageId;
const isApprovalProcessing = streaming.isApprovalProcessing;
const handleToolApproval = streaming.handleToolApproval;
const prepareMessageSend = streaming.prepareMessageSend;
const selectThread = streaming.selectThread;
const handleThreadDeleted = streaming.handleThreadDeleted;
const handleNewChat = streaming.handleNewChat;

const beginEditMessage = async (message: ChatUiMessage) => {
  const setDraft = async (text: string) => {
    await chatInputRef.value?.setDraftMessage(text, { focus: true, select: true });
  };
  await streaming.beginEditMessage(message, setDraft);
};

const regenerateMessage = async (message: ChatUiMessage) => {
  const setDraftAndSend = async (text: string) => {
    await chatInputRef.value?.replaceDraftMessageAndSend(text, { focus: true });
  };
  await streaming.beginEditMessage(message, setDraftAndSend);
};

const cancelEditing = async () => {
  const clearDraft = async () => {
    await chatInputRef.value?.setDraftMessage('', { focus: true });
  };
  await streaming.cancelEditing(clearDraft);
};

const handleComposeStarter = async (text: string) => {
  await chatInputRef.value?.setDraftMessage(text, {
    focus: true,
    select: true,
  });
  scrollToBottom();
};

const dismissOnboardingBanner = () => {
  if (!onboardingBannerStageKey.value) return;
  dismissedOnboardingStageKey.value = onboardingBannerStageKey.value;
};

useChatViewLifecycle({
  configStore,
  refreshThreads,
  loadToolSources,
  electronAPI,
  streamController,
  handleChatChunk,
  handleTaskPush,
});
</script>

<style scoped>
/* Messages styles */
.messages-area {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.onboarding-banner {
  display: grid;
  gap: 8px;
  width: min(100%, 860px);
  margin: 0 auto 16px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--success-color) 34%, var(--border-color));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--success-color) 11%, var(--bg-secondary)),
      color-mix(in srgb, var(--accent-color) 5%, var(--bg-primary))
    );
}

.onboarding-banner-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.onboarding-banner-label {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  border-radius: 999px;
  padding: 0 10px;
  background: color-mix(in srgb, var(--success-color) 18%, var(--bg-primary));
  color: color-mix(in srgb, var(--success-color) 84%, white 16%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.onboarding-banner-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.onboarding-banner-dismiss:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-color) 28%, var(--border-color));
  background: var(--bg-hover);
  color: var(--text-primary);
}

.onboarding-banner-dismiss:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 62%, white 38%);
  outline-offset: 2px;
}

.onboarding-banner-copy {
  display: grid;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.onboarding-banner-copy strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 650;
}

.chat-main-area {
  padding: var(--chat-content-padding, 24px);
  min-width: 0;
  overscroll-behavior: contain;
  scrollbar-gutter: stable both-edges;
}

.chat-main-area-welcome {
  align-items: flex-start;
  justify-content: center;
  padding-top: max(10px, calc(var(--chat-content-padding, 24px) - 12px));
  padding-bottom: max(16px, calc(var(--chat-content-padding, 24px) + 4px));
}

.messages-container {
  width: 100%;
  max-width: 860px;
  min-width: 0;
  margin: 0 auto;
}

.thread-origin-chip {
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.2;
}

.thread-origin-banner {
  width: 100%;
  max-width: 860px;
  margin: 0 auto 12px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.5;
}

.composer-area {
  width: 100%;
}

.edit-banner {
  width: 100%;
  max-width: 860px;
  margin: 0 auto 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
}

.edit-banner strong {
  color: var(--text-primary);
  font-weight: 650;
}

.edit-banner-cancel {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  flex-shrink: 0;
}

.edit-banner-cancel:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

@media (max-width: 768px) {
  .chat-main-area {
    padding: max(10px, calc(var(--chat-content-padding, 24px) - 8px));
  }

  .messages-container {
    max-width: 100%;
  }
}
</style>
