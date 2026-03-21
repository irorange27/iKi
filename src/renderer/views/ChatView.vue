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
      <div class="flex items-center justify-center p-4">
        <div class="ui-text-secondary flex items-center gap-1 text-sm">
          <span>{{ chatMessages.length }} messages</span>
          <span v-if="currentThread">·</span>
          <FolderOpen v-if="currentThread" :size="12" />
          <span v-if="currentThread">{{ currentThread.title }}</span>
        </div>
      </div>

      <!-- Main Area -->
      <div
        class="chat-main-area flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-y-auto"
        ref="messagesContainer"
      >
        <WelcomeScreen v-if="showWelcome && chatMessages.length === 0" @new-chat="handleNewChat" />

        <!-- Messages List -->
        <div v-else class="messages-area w-full h-full min-w-0">
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
              @edit-user-message="beginEditMessage"
              @open-skill="openSkillReference"
            />
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <div class="composer-area">
        <div v-if="editingUserMessageId" class="edit-banner">
          <div class="edit-banner-text">
            <strong>Editing a previous message.</strong> Resending will remove later messages in
            this thread.
          </div>
          <button class="edit-banner-cancel" type="button" @click="cancelEditing">Cancel</button>
        </div>
        <ChatInput
          ref="chatInputRef"
          :chat="chat"
          :thread-id="currentThread?.id || ''"
          :context-usage="composerContextUsage"
          @message-sent="handleMessageSent"
          @model-selected="handleModelSelected"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';
import { computed, ref, nextTick } from 'vue';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import { FolderOpen } from 'lucide-vue-next';
import {
  buildContextUsageIndicator,
  getContextReferenceSummary,
} from '../modules/chat/ui_message_references';
import { createUiMessagePersistence } from '../modules/chat/ui_message_persistence';
import { createChatMessageStore } from '../modules/chat/chat_message_store';
import type { ElectronApi } from '../../shared/types/electron_api';
import { useChatViewLifecycle } from '../composables/useChatViewLifecycle';
import { useConfigStore } from '../store/config';
import { useMarkdownCopy } from '../composables/useMarkdownCopy';
import { useChatThreads } from '../composables/useChatThreads';
import { useChatStreaming } from '../composables/useChatStreaming';
import { useToolMetadata } from '../composables/useToolMetadata';

type ChatInputExpose = {
  setDraftMessage: (
    text: string,
    options?: { focus?: boolean; select?: boolean }
  ) => Promise<void> | void;
};

const electronAPI = window.electronAPI as ElectronApi;

const configStore = useConfigStore();

// Create Chat instance for message management (without API endpoint for Electron)
const chat = new Chat<UIMessage>({});
const chatMessages = computed<UIMessage[]>(() => chat.messages as UIMessage[]);
const messagesContainer = ref<HTMLElement | null>(null);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const chatInputRef = ref<ChatInputExpose | null>(null);
const persistence = createUiMessagePersistence({ electronAPI });
const messageStore = createChatMessageStore(chat);
const { handleMarkdownClick } = useMarkdownCopy();

const createMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const { loadToolSources, getMcpServerLabel, openSkillReference } = useToolMetadata({
  electronAPI,
});

const composerContextUsage = computed(() => {
  const messages = Array.isArray(chat.messages) ? [...chat.messages] : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;

    const summary = getContextReferenceSummary(message);
    const indicator = buildContextUsageIndicator(summary, configStore.config.memory.context);
    if (indicator) return indicator;
  }

  return null;
});

const handleToolApprovalEvent = (payload: {
  approved: boolean;
  message: UIMessage;
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
  selectedTools,
  showWelcome,
  refreshThreads,
  createNewThread,
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
  handleModelSelected,
  getCurrentThreadId,
  handleAssistantMessagePersisted,
  handleTaskPush,
} = useChatThreads({
  electronAPI,
  messageStore,
  persistence,
  sidebarRef,
  scrollToBottom,
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
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
});

const streamController = streaming.streamController;
const editingUserMessageId = streaming.editingUserMessageId;
const isApprovalProcessing = streaming.isApprovalProcessing;
const handleToolApproval = streaming.handleToolApproval;
const handleMessageSent = streaming.handleMessageSent;
const selectThread = streaming.selectThread;
const handleThreadDeleted = streaming.handleThreadDeleted;
const handleNewChat = streaming.handleNewChat;

const beginEditMessage = async (message: UIMessage) => {
  const setDraft = async (text: string) => {
    await chatInputRef.value?.setDraftMessage(text, { focus: true, select: true });
  };
  await streaming.beginEditMessage(message, setDraft);
};

const cancelEditing = async () => {
  const clearDraft = async () => {
    await chatInputRef.value?.setDraftMessage('', { focus: true });
  };
  await streaming.cancelEditing(clearDraft);
};

useChatViewLifecycle({
  configStore,
  refreshThreads,
  loadToolSources,
  electronAPI,
  streamController,
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

.chat-main-area {
  padding: var(--chat-content-padding, 24px);
  min-width: 0;
}

.messages-container {
  width: 100%;
  max-width: 860px;
  min-width: 0;
  margin: 0 auto;
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
