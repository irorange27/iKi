<template>
  <div class="flex h-full min-h-0 app-background app-text">
    <Sidebar
      ref="sidebarRef"
      @thread-selected="selectThread"
      @new-chat="handleNewChat"
      @new-work="handleNewWork"
      @thread-deleted="handleThreadDeleted"
    />

    <!-- Main Content -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Header -->
      <div v-if="showHeaderMeta" class="flex items-center justify-center p-4">
        <div class="ui-text-secondary flex items-center gap-1 text-sm">
          <span v-if="showMessageCount">{{
            t('chat.messagesCount', { count: chatMessages.length })
          }}</span>
          <span v-if="showMessageCount && currentThread">·</span>
          <FolderOpen v-if="currentThread" :size="12" />
          <span v-if="currentThread">{{ currentThread.title }}</span>
          <span v-if="currentThreadOrigin?.isExternal" class="thread-origin-chip">
            {{ currentThreadOrigin.channelLabel || currentThreadOrigin.sourceLabel || 'External' }}
          </span>
          <button
            class="run-panel-toggle-btn"
            :class="{ active: showRunPanel }"
            type="button"
            :title="t('chat.runs.toggle')"
            @click="showRunPanel = !showRunPanel"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Main Area -->
      <div class="chat-main-wrap relative flex min-h-0 min-w-0 flex-1">
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
          <div v-if="externalThreadNotice" class="thread-origin-banner">
            {{ externalThreadNotice }}
          </div>
          <div class="messages-container" @click="handleMarkdownClick">
            <ChatMessageItem
              v-for="(m, index) in chatMessages"
              :key="m.id ? m.id : index"
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
          :workspace-locked="isWorkspaceLocked"
          :latest-token-usage="latestAssistantTokenUsage"
          :todo-plan="activeTodoPlan"
          :prepare-message-send="prepareMessageSend"
          :submit-turn="submitTurn"
          @new-chat-requested="handleNewChat"
          @clear-thread-requested="handleClearCurrentThread"
        />
        <ChatSessionStatsBar :stats="sessionPerfStats" />
      </div>
    </div>
    <RunPanel
      :visible="showRunPanel"
      :thread-id="currentThread?.id ?? null"
      :electronAPI="electronAPI"
      @close="showRunPanel = false"
    />
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
import { computed, ref, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import ChatSessionStatsBar from '../components/chat/ChatSessionStatsBar.vue';
import TurnPreviewCard from '../components/chat/TurnPreviewCard.vue';
import RunPanel from '../components/RunPanel.vue';
import { FolderOpen, X } from 'lucide-vue-next';
import { useI18n } from '../i18n';
import { buildSessionPerfStats, getTokenUsageSummary } from '../modules/chat/ui_message_references';
import { createChatInstance } from '../modules/chat/chat_instance';
import { createPrefixedId } from '@iki/backend/utils/id';
import { extractTextFromMessageParts } from '@iki/backend/message/message_parts';
import { useChatViewLifecycle } from '../composables/useChatViewLifecycle';
import { useConfigStore } from '../store/config';
import { useThreadSessionStore } from '../store/thread_session';
import { useMarkdownCopy } from '../composables/useMarkdownCopy';
import { useChatStreaming } from '../composables/useChatStreaming';
import { useChatThreadTodoPlan } from '../composables/useChatThreadTodoPlan';
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

// Chat runtime: SDK-owned message state + IPC transport (P6). Persistence,
// the message-store view and the approval controller hang off the same
// instance. `currentThread` and the thread callbacks are declared below —
// referenced lazily from closures.
const chatInstance = createChatInstance({
  electronAPI,
  generateId: () => createPrefixedId('msg'),
  getCurrentThreadId: () => currentThread.value?.id || null,
  onAssistantMessagePersisted: params => handleAssistantMessagePersisted(params),
  onStreamActivity: () => scrollToBottom(),
});
const chat = chatInstance.chat;
const persistence = chatInstance.persistence;
const messageStore = chatInstance.messageStore;
const chatMessages = computed<ChatUiMessage[]>(() => chat.messages);
const messagesContainer = ref<HTMLElement | null>(null);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const chatInputRef = ref<ChatInputExpose | null>(null);
const showRunPanel = ref(false);

// The AI SDK appends usage parts to a message in place, which does not
// invalidate computeds that only iterate `chat.messages`. Bump a counter when
// a usage chunk has been applied so session stats and the context indicator
// refresh within the same turn. The tap fires before the SDK consumes the
// chunk, hence the deferred bump; the status->ready watch is the guaranteed
// end-of-turn pass.
const usageChunkTick = ref(0);
chatInstance.transport.onChunk(chunk => {
  if (chunk.type !== 'data-token-usage') return;
  setTimeout(() => {
    usageChunkTick.value += 1;
  }, 0);
});
watch(
  chatInstance.status,
  status => {
    if (status === 'ready') usageChunkTick.value += 1;
  }
);

const createMessageId = () => createPrefixedId('msg');
const { handleMarkdownClick } = useMarkdownCopy();
const { loadToolSources, getMcpServerLabel } = useToolMetadata({
  electronAPI,
});

const latestAssistantTokenUsage = computed(() => {
  // Dependency on the usage-chunk tick: live usage parts mutate a message in
  // place and would otherwise not re-run this scan.
  void usageChunkTick.value;
  const messages = Array.isArray(chat.messages) ? [...chat.messages] : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;

    const summary = getTokenUsageSummary(message);
    if (summary && summary.inputTokens !== null) return summary;
  }

  return null;
});

// Session-cumulative perf stats for the bar under the composer. Message
// parts carry per-turn usage, so this survives reloads for free.
const sessionPerfStats = computed(() => {
  void usageChunkTick.value;
  return buildSessionPerfStats(Array.isArray(chat.messages) ? chat.messages : []);
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

// ── Fixed turn rail (Codex-style outline scrubber) ─────────────────────
// A strip pinned to the conversation's left edge carries one lines-marker per
// user message, stacked as a vertically centered column regardless of scroll.
// Hovering a marker previews the turn; clicking the marker or the preview card
// smooth-scrolls back to the turn's first message. The rail only appears once
// the conversation actually overflows.
const TURN_PREVIEW_HIDE_DELAY_MS = 220;
const TURN_RAIL_MIN_OVERFLOW_PX = 80;
// A rail over a short conversation is noise — it earns its place once there
// are enough turns to navigate between (and the thread actually overflows).
const TURN_RAIL_MIN_TURNS = 5;

const turnPreview = ref<{
  messageId: string;
  anchor: { top: number; left: number };
  messages: ChatUiMessage[];
} | null>(null);
const turnMarkers = ref<Array<string>>([]);
const turnHighlightIds = ref<Set<string> | null>(null);
let turnPreviewHideTimer: ReturnType<typeof setTimeout> | null = null;
let railResizeObserver: ResizeObserver | null = null;
let observedRailContent: HTMLElement | null = null;

const cancelTurnPreviewHide = () => {
  if (turnPreviewHideTimer) {
    clearTimeout(turnPreviewHideTimer);
    turnPreviewHideTimer = null;
  }
};

const hideTurnPreview = () => {
  cancelTurnPreviewHide();
  turnPreview.value = null;
  turnHighlightIds.value = null;
};

const scheduleTurnPreviewHide = () => {
  cancelTurnPreviewHide();
  turnPreviewHideTimer = setTimeout(() => {
    turnPreviewHideTimer = null;
    hideTurnPreview();
  }, TURN_PREVIEW_HIDE_DELAY_MS);
};

const buildTurnMessages = (messageId: string): ChatUiMessage[] => {
  const startIndex = chatMessages.value.findIndex(message => message.id === messageId);
  if (startIndex < 0) return [];
  const turnMessages: ChatUiMessage[] = [];
  for (let index = startIndex; index < chatMessages.value.length; index += 1) {
    const message = chatMessages.value[index];
    if (index > startIndex && message.role === 'user') break;
    turnMessages.push(message);
  }
  return turnMessages;
};

const showTurnPreviewFromRail = (event: MouseEvent, messageId: string) => {
  cancelTurnPreviewHide();
  const turnMessages = buildTurnMessages(messageId);
  if (!turnMessages.some(message => extractTextFromMessageParts(message.parts).trim())) {
    return;
  }
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  turnPreview.value = {
    messageId,
    anchor: { top: rect.top - 6, left: rect.right + 6 },
    messages: turnMessages,
  };
  turnHighlightIds.value = new Set(turnMessages.map(message => message.id));
};

const scrollToMessage = (messageId: string) => {
  if (!messagesContainer.value) return;
  messagesContainer.value
    .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const jumpToTurn = (messageId: string) => {
  hideTurnPreview();
  scrollToMessage(messageId);
};

const activateTurnPreview = () => {
  const messageId = turnPreview.value?.messageId;
  hideTurnPreview();
  if (messageId) scrollToMessage(messageId);
};

const attachRailResizeObserver = (content: HTMLElement | null) => {
  if (!content) {
    railResizeObserver?.disconnect();
    observedRailContent = null;
    return;
  }
  if (observedRailContent === content) return;
  railResizeObserver?.disconnect();
  observedRailContent = content;
  railResizeObserver?.observe(content);
};

const measureTurnMarkers = () => {
  const container = messagesContainer.value;
  const content = container?.querySelector<HTMLElement>('.messages-container') ?? null;
  attachRailResizeObserver(content);
  if (
    !container ||
    !content ||
    container.scrollHeight <= container.clientHeight + TURN_RAIL_MIN_OVERFLOW_PX
  ) {
    turnMarkers.value = [];
    return;
  }
  const markerIds: Array<string> = [];
  content
    .querySelectorAll<HTMLElement>('.message-wrapper.user[data-message-id]')
    .forEach(node => {
      const messageId = node.dataset.messageId;
      if (messageId) markerIds.push(messageId);
    });
  turnMarkers.value = markerIds.length >= TURN_RAIL_MIN_TURNS ? markerIds : [];
};

onBeforeUnmount(() => {
  railResizeObserver?.disconnect();
  railResizeObserver = null;
});

const {
  currentThread,
  currentModel,
  currentProviderId,
  currentReasoningEffort,
  currentPersonality,
  currentApprovalPolicy,
  isIncognito,
  selectedWorkspaceId,
  showWelcome,
} = storeToRefs(threadSession);
const {
  dismissWelcome,
  refreshThreads,
  createNewThread,
  handleModelSelected,
  ensureWorkspaceForCurrentThread,
  getCurrentThreadId,
  handleAssistantMessagePersisted,
  handleTaskPush,
  handleAwaiterPush,
} = threadSession;
const selectThreadBase = threadSession.selectThread;

onMounted(() => {
  railResizeObserver = new ResizeObserver(() => measureTurnMarkers());
  nextTick(measureTurnMarkers);
});

watch(
  () => [chatMessages.value.length, currentThread.value?.id],
  () => {
    nextTick(measureTurnMarkers);
  }
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
  persistence,
  sidebarRef,
  scrollToBottom,
  preferredDraftModel,
  preferredDraftProviderId,
  persistDraftModelSelection,
});

const { activeTodoPlan, handleChatChunk } = useChatThreadTodoPlan({
  electronAPI,
  threadId: computed(() => currentThread.value?.id || null),
});
// The transport is the single tap point for routed ui chunks (the todo-plan
// projection mirrors them; stale chunks never reach it).
chatInstance.transport.onChunk(handleChatChunk);

const streaming = useChatStreaming({
  electronAPI,
  chatInstance,
  messageStore,
  persistence,
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

// Cross-window jumps (e.g. the settings automations review queue) ask the
// main window to open a specific thread.
electronAPI.onFocusThread?.(threadId => {
  void selectThread(threadId);
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

.chat-main-area {
  padding: var(--chat-content-padding, 24px);
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
  max-width: 860px;
  min-width: 0;
  margin: 0 auto;
}

.chat-main-wrap {
  min-width: 0;
}

.turn-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 26px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}

.turn-rail-mark {
  pointer-events: auto;
  flex: 0 0 auto;
  display: block;
  padding: 3px 3px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.45;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease;
}

.turn-rail-mark span {
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-secondary);
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
  width: 20px;
  background: var(--accent-color);
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

.run-panel-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
}

.run-panel-toggle-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.run-panel-toggle-btn.active {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb), 0.25);
  background: rgba(var(--accent-rgb), 0.1);
}
</style>
