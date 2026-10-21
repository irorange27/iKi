<template>
  <div class="flex h-full min-h-0 app-background app-text">
    <Sidebar
      :workspace-locked="isWorkspaceLocked"
      :hide-collapsed-toolbar="showHeaderMeta"
      @thread-selected="selectThread"
      @new-chat="handleNewChat"
      @new-work="handleNewWork"
      @thread-deleted="handleThreadDeleted"
    />

    <!-- Main Content -->
    <div class="chat-content-column flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Header: conversation title row + view tabs. The hairline under the
           block closes the header, mirroring the sidebar's quiet separation.
           With the sidebar folded, the collapsed toolbar's controls move into
           this row as a leading cluster (DSH's leading seat) — they and the
           title share one line past the macOS traffic lights.
           The row also carries the workspace seat, so it renders even on the
           starting screen (no title yet): where tools will run has to be
           answerable before the first message exists. -->
      <header
        class="chat-header"
        :class="{ 'chat-header-leading-clear': sidebar.isCollapsed.value }"
      >
        <div class="chat-header-title-row">
          <template v-if="sidebar.isCollapsed.value">
            <!-- Two controls, and each must do what its label says. The toggle
                 used to carry the "Toggle sidebar" label while running
                 handleNewChat, so a folded sidebar had NO way to be reopened —
                 the one affordance that claimed to do it created a chat
                 instead. -->
            <button
              class="chat-header-tool-btn"
              type="button"
              :aria-label="t('chat.sidebar.toggle')"
              @click="sidebar.toggle"
            >
              <PanelLeftDashed :size="16" />
            </button>
            <button
              class="chat-header-tool-btn"
              type="button"
              :aria-label="t('chat.sidebar.newChat')"
              @click="handleNewChat"
            >
              <SquarePen :size="16" />
            </button>
          </template>
          <!-- Where tools will run. Leading seat of the title row, outside the
               composer: it is conversation context, not a send-time option. -->
          <WorkspaceSelector />
          <span v-if="currentThread" class="chat-header-sep" aria-hidden="true"></span>
          <h1 v-if="currentThread" class="chat-header-title" :title="currentThread.title">
            {{ currentThread.title }}
          </h1>
          <span v-if="currentThreadOrigin?.isExternal" class="thread-origin-chip">
            {{ currentThreadOrigin.channelLabel || currentThreadOrigin.sourceLabel || 'External' }}
          </span>
          <span v-if="showMessageCount" class="chat-header-meta">
            {{ t('chat.messagesCount', { count: chatMessages.length }) }}
          </span>
        </div>

        <div
          v-if="currentThread"
          class="chat-view-tabs flex h-9 shrink-0 items-end gap-5"
          role="tablist"
          :aria-label="t('chat.runs.views')"
        >
        <button
          id="chat-tab"
          type="button"
          role="tab"
          class="ui-tab h-full"
          :aria-selected="!showRunPanel"
          :tabindex="showRunPanel ? -1 : 0"
          aria-controls="chat-panel"
          @click="showRunPanel = false"
          @keydown.right.prevent="
            showRunPanel = true;
            focusViewTab('trajectory-tab');
          "
        >
          {{ t('chat.runs.chat') }}
        </button>
        <button
          id="trajectory-tab"
          type="button"
          role="tab"
          class="ui-tab h-full"
          :aria-selected="showRunPanel"
          :tabindex="showRunPanel ? 0 : -1"
          aria-controls="trajectory-panel"
          @click="showRunPanel = true"
          @keydown.left.prevent="
            showRunPanel = false;
            focusViewTab('chat-tab');
          "
        >
          {{ t('chat.runs.title') }}
        </button>
        </div>
      </header>
      <TrajectoryView
        v-if="trajectoryMounted"
        v-show="showRunPanel"
        :active="showRunPanel"
        id="trajectory-panel"
        role="tabpanel"
        aria-labelledby="trajectory-tab"
        class="min-h-0 min-w-0 flex-1"
        :thread-id="currentThread?.id ?? null"
        @close="showRunPanel = false"
      />

      <!-- Main Area -->
      <div
        v-show="!showRunPanel"
        id="chat-panel"
        role="tabpanel"
        aria-labelledby="chat-tab"
        class="chat-main-wrap relative flex min-h-0 min-w-0 flex-1"
      >
        <div
          class="chat-main-area ui-scrollbar flex min-h-0 min-w-0 flex-1 overflow-y-auto"
          :class="showWelcomeScreen ? 'chat-main-area-welcome' : 'items-center justify-center'"
          ref="messagesContainer"
          @scroll="handleMessagesScroll"
        >
          <WelcomeScreen
            v-if="showWelcomeScreen"
            :active-model="currentModel"
            :active-provider-id="currentProviderId"
            @compose-starter="handleComposeStarter"
          />

          <!-- Messages List -->
          <div v-else class="messages-area w-full h-full min-w-0">
            <div v-if="externalThreadNotice" class="thread-origin-banner">
              {{ externalThreadNotice }}
            </div>
            <!-- Delegation only: it forwards clicks to the copy <button> that the
                 markdown plugin renders inside, which is natively keyboard
                 operable. The container itself is not a control. -->
            <div
              class="messages-container"
              data-a11y-delegated-click
              @click="handleMarkdownClick"
            >
              <ChatMessageItem
                v-for="(m, index) in chatMessages"
                :key="m.id"
                :message="m"
                :message-index="index"
                :active-assistant-message-id="chatInstance.activeAssistantMessageId.value"
                :turn-highlight-ids="turnHighlightIds"
                :approval-processing="isApprovalProcessing"
                :get-mcp-server-label="getMcpServerLabel"
                @approve-tool="handleToolApprovalEvent"
                @regenerate-user-message="regenerateMessage"
                @edit-user-message="beginEditMessage"
              />
            </div>
          </div>
        </div>

        <!-- Fixed turn rail: one thin line per turn, pinned to the left edge
             and vertically centered regardless of scroll. All lines share the
             same length; hovering one lengthens/tints it AND highlights the
             corresponding turn in the conversation. Click jumps to it. -->
        <div v-if="turnMarkers.length > 0" class="turn-rail">
          <button
            v-for="messageId in turnMarkers"
            :key="messageId"
            class="turn-rail-mark"
            type="button"
            :aria-label="t('chat.turnPreview.jump')"
            :title="t('chat.turnPreview.jump')"
            @click="jumpToTurn(messageId)"
            @mouseenter="showTurnPreviewFromRail($event, messageId)"
            @mouseleave="scheduleTurnPreviewHide"
          >
            <span></span>
          </button>
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
          :approval-policy="currentApprovalPolicy"
          :latest-token-usage="latestAssistantTokenUsage"
          :session-perf-stats="sessionPerfStats"
          :prepare-message-send="prepareMessageSend"
          :submit-turn="submitTurn"
          @new-chat-requested="handleNewChat"
          @clear-thread-requested="handleClearCurrentThread"
        />
        <ChatSessionStatsBar :stats="sessionPerfStats" />
      </div>
    </div>
    <TurnPreviewCard
      :anchor="turnPreview?.anchor ?? null"
      :messages="turnPreview?.messages ?? null"
      @activate="activateTurnPreview"
      @mouse-enter="cancelTurnPreviewHide"
      @mouse-leave="scheduleTurnPreviewHide"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onBeforeUnmount } from 'vue';
import { PanelLeftDashed, SquarePen } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import WorkspaceSelector from '../components/WorkspaceSelector.vue';
import { useSidebar } from '../composables/useSidebar';
import ChatInput from '../components/ChatInput.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import ChatSessionStatsBar from '../components/chat/ChatSessionStatsBar.vue';
import TurnPreviewCard from '../components/chat/TurnPreviewCard.vue';
import TrajectoryView from './TrajectoryView.vue';
import { useI18n } from '../i18n';
import { useChatUsage } from '../composables/useChatUsage';
import { createChatInstance } from '../modules/chat/chat_instance';
import { createPrefixedId } from '@iki/backend/utils/id';
import { useTurnRail } from '../composables/useTurnRail';
import { useChatViewLifecycle } from '../composables/useChatViewLifecycle';
import { useConfigStore } from '../store/config';
import { useThreadSessionStore } from '../store/thread_session';
import { useMarkdownCopy } from '../composables/useMarkdownCopy';
import { useChatStreaming } from '../composables/useChatStreaming';
import { useToolMetadata } from '../composables/useToolMetadata';
import { getThreadOriginInfo } from '../modules/chat/thread_origin';
import { getElectronAPI } from '../services/electron_api';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

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
const threadSession = useThreadSessionStore();
const preferredDraftModel = computed(() => configStore.config?.chat?.composer?.preferredModel);
const preferredDraftProviderId = computed(
  () => configStore.config?.chat?.composer?.preferredProviderId
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

const chatInstance = createChatInstance({
  electronAPI,
  generateId: () => createPrefixedId('msg'),
  getCurrentThreadId: () => currentThread.value?.id || null,
  onAssistantMessagePersisted: params => handleAssistantMessagePersisted(params),
  onStreamActivity: () => scheduleFollowScroll(),
});
const chat = chatInstance.chat;
const messageStore = chatInstance.messageStore;
const chatMessages = computed<ChatUiMessage[]>(() => chat.messages);
const messagesContainer = ref<HTMLElement | null>(null);
const chatInputRef = ref<ChatInputExpose | null>(null);
const showRunPanel = ref(false);
const trajectoryMounted = ref(false);
watch(showRunPanel, visible => {
  if (visible) trajectoryMounted.value = true;
});
const focusViewTab = (id: string) => {
  void nextTick(() => document.getElementById(id)?.focus());
};

const usageChunkTick = ref(0);
let usageRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const removeUsageListener = chatInstance.transport.onChunk(chunk => {
  if (chunk.type !== 'data-token-usage' || usageRefreshTimer !== null) return;
  usageRefreshTimer = setTimeout(() => {
    usageRefreshTimer = null;
    usageChunkTick.value += 1;
  }, 0);
});
onBeforeUnmount(() => {
  removeUsageListener();
  if (usageRefreshTimer !== null) clearTimeout(usageRefreshTimer);
});
watch(chatInstance.status, status => {
  if (status === 'ready' || status === 'error') usageChunkTick.value += 1;
});

const createMessageId = () => createPrefixedId('msg');
const { handleMarkdownClick } = useMarkdownCopy();
const sidebar = useSidebar();
const { loadToolSources, getMcpServerLabel } = useToolMetadata({
  electronAPI,
});

const { latestAssistantTokenUsage, sessionPerfStats } = useChatUsage(
  () => chat.messages,
  () => messageStore.revision,
  usageChunkTick
);

const showMessageCount = computed(() => chatMessages.value.length > 0);
const showHeaderMeta = true;
const showWelcomeScreen = computed(() => showWelcome.value && chatMessages.value.length === 0);
const isWorkspaceLocked = computed(
  () => Boolean(currentThread.value?.id) && chatMessages.value.length > 0
);

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

const handleToolApprovalEvent = (payload: {
  approved: boolean;
  message: ChatUiMessage;
  part: unknown;
}) => {
  void handleToolApproval(payload.message, payload.part, payload.approved);
};

const FOLLOW_TAIL_THRESHOLD_PX = 40;
let pinnedToBottom = true;
let followScrollRaf: number | null = null;

const handleMessagesScroll = () => {
  const el = messagesContainer.value;
  if (!el) return;
  pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_TAIL_THRESHOLD_PX;
};

const scheduleFollowScroll = () => {
  if (!pinnedToBottom || followScrollRaf !== null) return;
  followScrollRaf = requestAnimationFrame(() => {
    followScrollRaf = null;
    const el = messagesContainer.value;
    if (el && pinnedToBottom) el.scrollTop = el.scrollHeight;
  });
};

const scrollToBottom = () => {
  pinnedToBottom = true;
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

onBeforeUnmount(() => {
  if (followScrollRaf !== null) cancelAnimationFrame(followScrollRaf);
});

const { currentThread, currentModel, currentProviderId, currentApprovalPolicy, showWelcome } =
  storeToRefs(threadSession);
const {
  dismissWelcome,
  refreshThreads,
  createNewThread,
  ensureWorkspaceForCurrentThread,
  getCurrentThreadId,
  handleAssistantMessagePersisted,
  handleTaskPush,
  handleAwaiterPush,
} = threadSession;
const selectThreadBase = threadSession.selectThread;

watch(
  () => currentThread.value?.id,
  id => {
    if (!id) showRunPanel.value = false;
  },
  { flush: 'sync' }
);

const {
  turnPreview,
  turnMarkers,
  turnHighlightIds,
  cancelTurnPreviewHide,
  scheduleTurnPreviewHide,
  showTurnPreviewFromRail,
  jumpToTurn,
  activateTurnPreview,
} = useTurnRail(
  chatMessages,
  messagesContainer,
  computed(() => currentThread.value?.id),
  computed(() => !showRunPanel.value)
);
const handleThreadDeletedBase = threadSession.handleThreadDeleted;
const handleNewChatBase = threadSession.handleNewChat;
const clearCurrentThreadBase = threadSession.clearCurrentThread;

const handleNewWork = async (workspaceId: string) => {
  await threadSession.createNewThread({ mode: 'work', workspaceId });
};

threadSession.initRuntime({
  electronAPI,
  messageStore,
  scrollToBottom,
  preferredDraftModel,
  preferredDraftProviderId,
  persistDraftModelSelection,
});

const streaming = useChatStreaming({
  electronAPI,
  chatInstance,
  messageStore,
  createMessageId,
  scrollToBottom,
  getCurrentThreadId,
  onAssistantMessagePersisted: handleAssistantMessagePersisted,
  currentThread,
  currentModel,
  showWelcome,
  createNewThread,
  clearCurrentThread: clearCurrentThreadBase,
  ensureWorkspaceForCurrentThread,
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
});

const editingUserMessageId = streaming.editingUserMessageId;
const isApprovalProcessing = chatInstance.isApprovalProcessing;
const handleToolApproval = chatInstance.handleToolApproval;
const prepareMessageSend = streaming.prepareMessageSend;
const submitTurn = streaming.submitTurn;
const selectThread = streaming.selectThread;
const handleThreadDeleted = streaming.handleThreadDeleted;
const handleNewChat = streaming.handleNewChat;
const handleClearCurrentThread = streaming.handleClearCurrentThread;

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
  dismissWelcome();
  await chatInputRef.value?.setDraftMessage(text, {
    focus: true,
    select: true,
  });
  scrollToBottom();
};

useChatViewLifecycle({
  configStore,
  refreshThreads,
  loadToolSources,
  electronAPI,
  handleTaskPush,
  handleAwaiterPush,
});

electronAPI.onFocusThread?.(threadId => {
  void selectThread(threadId);
});
</script>

<style scoped>
/* Conversation header (DSH ConversationHeader): title row over the view tabs,
   one hairline closing the block. The title is the page's h1; message count
   and origin ride after it as quiet metadata. */
/* Top-left workspace seat. It owns its row so it stays put whether or not the
   header (title + tabs) is rendered, and it never competes with the composer
   for attention. When the sidebar is folded the column reaches the window edge
   and macOS traffic lights (20,20) overlay this zone, hence the 84px indent —
   the same clearance the header uses. */
.chat-workspace-bar {
  flex: none;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 8px clamp(14px, 2.2cqw, var(--chat-content-padding, 24px)) 0;
}

.chat-workspace-bar--collapsed {
  padding-left: 84px;
}

.chat-header {
  flex: none;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
}

.chat-header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  /* Vertical rhythm follows the window height: in a short window the header
     gives rows back to the conversation instead of keeping desktop air. */
  min-height: clamp(24px, 3.2vh, 30px);
  padding: clamp(6px, 1.4vh, 10px) clamp(14px, 2.2cqw, var(--chat-content-padding, 24px)) 0;
}

/* Sidebar folded: the chat column reaches the window edge, and hiddenInset
   traffic lights (20,20) overlay the leading zone. The collapsed toolbar's
   controls render inline in this row, so one indent clears the lights for
   the whole line. */
.chat-header-leading-clear .chat-header-title-row {
  padding-left: 84px;
}

.chat-header-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.chat-header-tool-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Divides the workspace seat from the conversation title. Quiet on purpose:
   both are metadata on the same line, neither should read as a control. */
.chat-header-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: color-mix(in srgb, var(--border-color) 70%, transparent);
}

/* Divides the workspace seat from the conversation title. Quiet on purpose:
   both are metadata on the same line, neither should read as a control. */
.chat-header-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: color-mix(in srgb, var(--border-color) 70%, transparent);
}

.chat-header-title {
  margin: 0;
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--text-primary);
}

.chat-header-meta {
  flex: none;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-muted);
}

/* The tab row is one of the fixed rows around the conversation, so it shrinks
   with the window height before the message area has to. */
.chat-view-tabs {
  height: clamp(28px, 4vh, 36px);
  padding: 0 clamp(14px, 2.2cqw, var(--chat-content-padding, 24px));
}

/* Messages styles */
.messages-area {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.chat-main-area {
  /* Container-over-viewport companion: the horizontal gutter follows the chat
     area's own width (cqw resolves against .chat-main-wrap below), so dragging
     the sidebar and resizing the window produce one continuous rhythm instead
     of a 24px -> 16px step at a viewport breakpoint. The block gutter follows
     the window height for the same reason. */
  padding: clamp(12px, 3.4vh, 24px) clamp(14px, 2.2cqw, var(--chat-content-padding, 24px));
  min-width: 0;
  overscroll-behavior: contain;
  scrollbar-gutter: stable both-edges;
}

.chat-main-area-welcome {
  align-items: center;
  justify-content: center;
}

.messages-container {
  width: 100%;
  max-width: var(--chat-column-max);
  min-width: 0;
  margin: 0 auto;
}

.chat-content-column {
  /* Conversation column follows the chat area: 82% up to the 1600px cap, and
     fluid all the way down to a 360px column instead of freezing at 860px
     (which left the column wider than its container below ~1050px of chat
     area and made the "fluid" middle band a no-op). Lives on the shared
     column so the composer below the panel tracks the same width as the
     messages. */
  --chat-column-max: clamp(360px, 82%, 1600px);
  /* The header and composer rows query this column rather than the viewport,
     so the sidebar's drag width participates in their reflow. */
  container-type: inline-size;
}

.chat-main-wrap {
  min-width: 0;
  /* Rail visibility keys off the chat area, not the viewport: the sidebar is
     drag-resizable, so the same window width leaves very different rooms. */
  container-type: inline-size;
}

.turn-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 16px;
  z-index: 19;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 3px;
  pointer-events: none;
}

/* Rest state is nearly invisible — a faint 8px hairline stack; only hovering
   a mark makes it prominent (lengthens, tints accent). */
.turn-rail-mark {
  pointer-events: auto;
  flex: 0 0 auto;
  display: block;
  padding: 3px 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.3;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease;
}

.turn-rail-mark span {
  display: block;
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-muted);
  transition:
    width 0.15s ease,
    background-color 0.15s ease;
}

.turn-rail-mark:hover,
.turn-rail-mark:focus-visible {
  opacity: 1;
  background: var(--bg-hover);
  outline: none;
}

.turn-rail-mark:hover span,
.turn-rail-mark:focus-visible span {
  width: 16px;
  background: var(--accent-color);
}

.thread-origin-chip {
  flex: none;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
  background: transparent;
  color: var(--text-muted);
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.2;
}

.thread-origin-banner {
  width: 100%;
  max-width: var(--chat-column-max);
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
  max-width: var(--chat-column-max);
  margin: 0 auto;
}

.edit-banner {
  width: 100%;
  max-width: var(--chat-column-max);
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

@media (max-width: 768px) {
  .chat-main-area {
    padding: max(10px, calc(var(--chat-content-padding, 24px) - 8px));
  }

  .messages-container {
    max-width: 100%;
  }
}

@media (max-width: 768px) {
  .chat-main-area {
    padding: max(10px, calc(var(--chat-content-padding, 24px) - 8px));
  }

  .messages-container {
    max-width: 100%;
  }
}

/* The rail borrows the left gutter; once the chat area narrows past the
   point where the gutter holds it beside the text, drop it entirely. Same
   narrow threshold the trajectory view collapses its detail chrome at. */
@container (max-width: 720px) {
  .turn-rail {
    display: none;
  }
}
</style>
