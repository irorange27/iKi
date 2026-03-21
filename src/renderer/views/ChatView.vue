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
            <div
              v-for="(m, index) in chatMessages"
              :key="m.id ? m.id : index"
              class="message-wrapper"
              :class="m.role"
            >
              <div class="message-shell">
                <ChatMessageReferences :message="m" @open-skill="openSkillReference" />
                <div class="message-content">
                  <div
                    v-for="(part, partIndex) in m.parts"
                    :key="getPartRenderKey(m.id || String(index), part, partIndex)"
                    class="message-part"
                  >
                    <div v-if="isStreamingTextPart(m, part)" class="message-text">
                      {{ getTextPartContent(part) }}
                    </div>
                    <div v-else-if="isTextPart(part)" class="message-text markdown-content">
                      <VueMarkdown :source="getTextPartContent(part)" :plugins="markdownPlugins" />
                    </div>
                    <div
                      v-else-if="shouldHideReferencePart(part)"
                      class="reference-part-hidden"
                      aria-hidden="true"
                    ></div>
                    <ChatToolPart
                      v-else
                      :approval-processing="isApprovalProcessing(part)"
                      :mcp-server-label="getMcpServerLabel(part)"
                      :message="m"
                      :part="part"
                      @approve-tool="handleToolApprovalEvent"
                    />
                  </div>
                </div>
                <div v-if="m.role === 'user'" class="message-actions">
                  <button
                    class="message-action-btn"
                    type="button"
                    data-tooltip="Edit"
                    aria-label="Edit"
                    @click.stop="beginEditMessage(m)"
                  >
                    <Pencil class="message-action-icon" :size="14" />
                  </button>
                </div>
              </div>
            </div>
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
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import ChatMessageReferences from '../components/chat/ChatMessageReferences.vue';
import ChatToolPart from '../components/chat/ChatToolPart.vue';
import { FolderOpen, Pencil } from 'lucide-vue-next';
import {
  getToolName,
} from '../modules/chat/ui_message_tool_parts';
import {
  buildContextUsageIndicator,
  getContextReferenceSummary,
} from '../modules/chat/ui_message_references';
import { createUiMessagePersistence } from '../modules/chat/ui_message_persistence';
import { createChatMessageStore } from '../modules/chat/chat_message_store';
import { isTextPart } from '../modules/chat/ui_message_text';
import {
  isContextReportPart,
  isMemoryPart,
  isObjectRecord,
  isSkillUsagePart,
} from '../../shared/chat/message_parts';
import type { ElectronApi } from '../../shared/types/electron_api';
import { useConfigStore } from '../store/config';
import { useChatThreads } from '../composables/useChatThreads';
import { useChatStreaming } from '../composables/useChatStreaming';
import VueMarkdown from 'vue-markdown-render';
import { markdownCodeBlockPlugin } from '../utils/markdown_code_block_plugin';

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

const createMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

type ToolSource = {
  kind?: 'builtin' | 'mcp';
  id?: string;
  name?: string;
};

const toolSourceMap = ref<Map<string, ToolSource>>(new Map());
const toolSourceLoading = ref(false);

const loadToolSources = async () => {
  if (toolSourceLoading.value) return;
  toolSourceLoading.value = true;
  try {
    if (!electronAPI?.tools?.list) return;
    const list = await electronAPI.tools.list();
    if (!Array.isArray(list)) return;
    const next = new Map<string, ToolSource>();
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const name = (item as { name?: unknown }).name;
      if (typeof name !== 'string' || !name.trim()) continue;
      const source = (item as { source?: unknown }).source;
      if (source && typeof source === 'object') {
        next.set(name, source as ToolSource);
      }
    }
    toolSourceMap.value = next;
  } catch (error) {
    console.warn('Failed to load tool metadata:', error);
  } finally {
    toolSourceLoading.value = false;
  }
};

const getMcpServerLabel = (part: unknown): string => {
  const toolName = getToolName(part);
  if (!toolName) return '';
  const source = toolSourceMap.value.get(toolName);
  if (!source && (toolName.startsWith('mcp_') || toolName.startsWith('mcp:'))) {
    void loadToolSources();
  }
  if (source?.kind !== 'mcp') return '';
  return source.name || source.id || '';
};

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

const openSkillReference = async (skillId: string) => {
  try {
    const result = await electronAPI?.skills?.openSkill?.(skillId);
    if (result?.success) return;
    console.warn('Failed to open skill:', result?.error || skillId);
  } catch (error) {
    console.warn('Failed to open skill:', error);
  }
};

const shouldHideReferencePart = (part: unknown): boolean =>
  isSkillUsagePart(part) || isMemoryPart(part) || isContextReportPart(part);

const handleToolApprovalEvent = (payload: {
  approved: boolean;
  message: UIMessage;
  part: unknown;
}) => {
  void handleToolApproval(payload.message, payload.part, payload.approved);
};

const markdownPlugins = [markdownCodeBlockPlugin];

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getPartRenderKey = (messageId: string, part: unknown, partIndex: number): string => {
  const partType = getPartType(part);
  if (isTextPart(part)) {
    return `${messageId}-${partType}-${partIndex}-${part.text.length}-${streamController.streamRenderTick.value}`;
  }
  return `${messageId}-${partType}-${partIndex}`;
};

const getTextPartContent = (part: unknown): string => {
  // Re-render streaming text even if the part object is mutated in-place.
  void streamController.streamRenderTick.value;
  return isTextPart(part) ? part.text : '';
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
};

const handleMarkdownClick = async (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const copyButton = target.closest('.md-code-copy-btn') as HTMLButtonElement | null;
  if (!copyButton) return;

  const codeElement = copyButton.closest('.md-code-block')?.querySelector('pre code');
  const codeText = codeElement?.textContent ?? '';
  if (!codeText.trim()) return;

  const copied = await copyTextToClipboard(codeText);
  if (!copied) return;

  copyButton.dataset.copied = 'true';
  window.setTimeout(() => {
    delete copyButton.dataset.copied;
  }, 1200);
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
const isStreamingTextPart = streaming.isStreamingTextPart;
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

// Listen for model selection from ChatInput
onMounted(async () => {
  // Initialize config store if not already initialized
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  // Load threads on mount
  await refreshThreads();
  await loadToolSources();

  electronAPI.chat.removeAllListeners();
  electronAPI.chat.onUiChunk((chunk: unknown) => {
    void streamController.handleUiChunk(chunk);
  });

  try {
    electronAPI.tasks?.removeAllListeners?.();
    electronAPI.tasks?.onPush?.((payload: unknown) => {
      void handleTaskPush(payload);
    });
  } catch {
    // Ignore missing tasks IPC in older builds.
  }
});

onUnmounted(() => {
  electronAPI.chat.removeAllListeners();
  try {
    electronAPI.tasks?.removeAllListeners?.();
  } catch {
    // ignore
  }
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

.message-wrapper {
  margin-bottom: var(--chat-message-gap, 18px);
}

.message-shell {
  position: relative;
  min-width: 0;
}

.reference-part-hidden {
  display: none;
}

.message-wrapper.user .message-shell {
  margin-left: auto;
  width: fit-content;
  max-width: min(85%, 760px);
}

.message-wrapper.assistant .message-shell {
  max-width: min(100%, 760px);
  margin-right: clamp(0px, 4vw, 56px);
}

.message-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  position: absolute;
  left: 10px;
  bottom: -18px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: 10;
}

.message-wrapper.user .message-content:hover + .message-actions,
.message-wrapper.user .message-actions:hover {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-btn {
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-tertiary) 82%, transparent);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.message-action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.message-action-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  white-space: nowrap;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  box-shadow: var(--surface-shadow-md);
  color: var(--text-primary);
  font-size: 12px;
  letter-spacing: 0.01em;
  opacity: 0;
  transform: translate(-50%, 4px);
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.message-action-btn:hover::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.message-action-icon {
  display: block;
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

.message-wrapper.user .message-content {
  background: var(--chat-user-bubble-background);
  border: 1px solid var(--chat-user-bubble-border-color);
  border-radius: var(--chat-user-bubble-radius, 28px);
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
  box-shadow: var(--chat-user-bubble-shadow);
}

.message-wrapper.assistant .message-content {
  background: var(--bg-primary);
  border-radius: 12px;
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
}

.message-text {
  color: var(--text-primary);
  font-size: var(--font-size);
  line-height: 1.72;
  letter-spacing: 0.01em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-text.markdown-content {
  white-space: normal;
}

.message-wrapper.user .message-text {
  color: var(--chat-user-bubble-text);
}

.message-part + .message-part {
  margin-top: 12px;
}

.message-text.markdown-content :deep(p) {
  margin: 0 0 0.9em;
}

.message-text.markdown-content :deep(h1),
.message-text.markdown-content :deep(h2),
.message-text.markdown-content :deep(h3) {
  margin: 1.2em 0 0.6em;
  line-height: 1.4;
  color: var(--text-primary);
  font-weight: 650;
}

.message-text.markdown-content :deep(h1) {
  font-size: 1.3em;
}

.message-text.markdown-content :deep(h2) {
  font-size: 1.18em;
}

.message-text.markdown-content :deep(h3) {
  font-size: 1.05em;
}

.message-text.markdown-content :deep(ul),
.message-text.markdown-content :deep(ol) {
  margin: 0.7em 0 0.95em 1.25em;
  padding: 0;
}

.message-text.markdown-content :deep(ul) {
  list-style: disc;
  list-style-position: outside;
}

.message-text.markdown-content :deep(ol) {
  list-style: decimal;
  list-style-position: outside;
}

.message-text.markdown-content :deep(li + li) {
  margin-top: 0.28em;
}

.message-text.markdown-content :deep(blockquote) {
  margin: 0.95em 0;
  padding: 0.5em 0.9em;
  border-left: 3px solid var(--accent-color);
  border-radius: 0 8px 8px 0;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.message-text.markdown-content :deep(a) {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent-color) 55%, transparent);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.message-text.markdown-content :deep(a:hover) {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}

.message-wrapper.user .message-text.markdown-content :deep(a) {
  color: var(--chat-user-bubble-text);
  border-bottom-color: color-mix(in srgb, var(--chat-user-bubble-text) 45%, transparent);
}

.message-wrapper.user .message-text.markdown-content :deep(a:hover) {
  color: var(--chat-user-bubble-text);
  border-bottom-color: color-mix(in srgb, var(--chat-user-bubble-text) 72%, transparent);
}

.message-wrapper.user .message-text.markdown-content :deep(blockquote) {
  border-left-color: color-mix(in srgb, var(--chat-user-bubble-text) 55%, transparent);
  background: color-mix(in srgb, var(--chat-user-bubble-text) 8%, transparent);
  color: color-mix(in srgb, var(--chat-user-bubble-text) 90%, transparent);
}

.message-wrapper.user .message-text.markdown-content :deep(code) {
  background: color-mix(in srgb, var(--chat-user-bubble-text) 12%, transparent);
  border-color: color-mix(in srgb, var(--chat-user-bubble-text) 18%, transparent);
  color: var(--chat-user-bubble-text);
}

.message-text.markdown-content :deep(hr) {
  margin: 1.1em 0;
  border: 0;
  border-top: 1px solid var(--border-color);
}

.message-text.markdown-content :deep(table) {
  width: 100%;
  margin: 0.9em 0;
  border-collapse: collapse;
  font-size: 0.93em;
}

.message-text.markdown-content :deep(th),
.message-text.markdown-content :deep(td) {
  padding: 0.45em 0.65em;
  border: 1px solid var(--border-color);
  text-align: left;
  vertical-align: top;
}

.message-text.markdown-content :deep(th) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 600;
}

.message-text.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text.markdown-content :deep(pre) {
  margin: 10px 0;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow-x: auto;
}

.message-text.markdown-content :deep(code) {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 1px 6px;
}

.message-text.markdown-content :deep(pre code) {
  display: block;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  font-size: 12px;
  color: var(--text-primary);
}

.message-text.markdown-content :deep(.md-code-block) {
  margin: 12px 0;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg-secondary);
}

.message-text.markdown-content :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border-color);
}

.message-text.markdown-content :deep(.md-code-lang) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  text-transform: lowercase;
}

.message-text.markdown-content :deep(.md-code-lang::before) {
  content: '⌘';
  font-size: 12px;
  color: var(--accent-color);
}

.message-text.markdown-content :deep(.md-code-copy-btn) {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.message-text.markdown-content :deep(.md-code-copy-btn:hover) {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}

.message-text.markdown-content :deep(.md-code-copy-btn[data-copied='true']) {
  color: var(--success-color, var(--accent-color));
}

.message-text.markdown-content :deep(.md-code-copy-btn svg) {
  width: 15px;
  height: 15px;
}

.message-text.markdown-content :deep(.md-code-block pre) {
  margin: 0;
  padding: 10px 14px;
  border: none;
  border-radius: 0;
  background: var(--bg-primary);
}

.message-text.markdown-content :deep(.md-code-block pre code) {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  color: var(--text-primary);
}

.message-text.markdown-content :deep(.md-code-block pre code.hljs) {
  background: transparent;
  margin: 0;
  padding: 0 !important;
}

@media (max-width: 768px) {
  .chat-main-area {
    padding: max(10px, calc(var(--chat-content-padding, 24px) - 8px));
  }

  .messages-container {
    max-width: 100%;
  }

  .message-wrapper.user .message-shell,
  .message-wrapper.assistant .message-shell {
    max-width: 100%;
  }

  .message-wrapper.assistant .message-shell {
    margin-right: 0;
  }

  .message-text {
    font-size: calc(var(--font-size) - 1px);
    line-height: 1.68;
  }

  .message-actions {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
}

.typing-cursor {
  display: inline-block;
  color: var(--accent-color);
  animation: blink 1s infinite;
  margin-left: 2px;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

</style>
