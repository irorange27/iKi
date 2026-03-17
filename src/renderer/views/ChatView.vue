<template>
  <div class="flex h-screen app-background app-text">
    <Sidebar
      ref="sidebarRef"
      @thread-selected="selectThread"
      @new-chat="handleNewChat"
      @thread-deleted="handleThreadDeleted"
    />

    <!-- Main Content -->
    <div class="flex flex-1 flex-col">
      <!-- Header -->
      <div class="flex items-center justify-center p-4">
        <div class="flex items-center gap-1 text-sm text-secondary">
          <span>{{ chat.messages.length }} messages</span>
          <span v-if="currentThread">·</span>
          <FolderOpen v-if="currentThread" :size="12" />
          <span v-if="currentThread">{{ currentThread.title }}</span>
        </div>
      </div>

      <!-- Main Area -->
      <div class="chat-main-area flex flex-1 items-center justify-center overflow-y-auto" ref="messagesContainer">
        <WelcomeScreen v-if="showWelcome && chat.messages.length === 0" @new-chat="handleNewChat" />

        <!-- Messages List -->
          <div v-else class="messages-area w-full h-full">
          <div class="messages-container" @click="handleMarkdownClick">
            <div v-for="(m, index) in chat.messages" :key="m.id ? m.id : index" class="message-wrapper" :class="m.role">
              <div class="message-shell">
                <div
                  v-if="m.role === 'assistant' && getUsedToolNames(m).length > 0"
                  class="tool-usage-summary"
                >
                  <span class="tool-usage-label">Tools used</span>
                  <span
                    v-for="toolName in getUsedToolNames(m)"
                    :key="toolName"
                    class="tool-usage-pill"
                  >
                    {{ toolName }}
                  </span>
                </div>
                <div class="message-content">
                  <div v-for="(part, partIndex) in m.parts" :key="getPartRenderKey(m.id || String(index), part, partIndex)"
                    class="message-part">
                  <div v-if="isStreamingTextPart(m as any, part)" class="message-text">
                    {{ getTextPartContent(part) }}
                  </div>
                  <div v-else-if="isTextPart(part)" class="message-text markdown-content">
                    <VueMarkdown :source="getTextPartContent(part)" :plugins="markdownPlugins" />
                  </div>
                  <div v-else-if="isApprovalRequestedPart(part)" class="tool-approval-content">
                    <div class="tool-approval-header">
                      <svg class="tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span class="tool-approval-title">Tool Approval Request</span>
                    </div>
                    <div class="tool-approval-body">
                      <div class="tool-name">
                        {{ getToolName(part) }}
                      </div>
                      <div class="tool-args">
                        <pre>{{ formatJson(getToolInput(part)) }}</pre>
                      </div>
                    </div>
                    <div class="tool-approval-actions">
                      <button class="approve-btn" @click="handleToolApproval(m as any, part as any, true)"
                        :disabled="isApprovalProcessing(part)">
                        Approve
                      </button>
                      <button class="reject-btn" @click="handleToolApproval(m as any, part as any, false)"
                        :disabled="isApprovalProcessing(part)">
                        Reject
                      </button>
                    </div>
                  </div>
                  <div
                    v-else-if="isToolResultPart(part)"
                    class="tool-result-content"
                    :class="{ 'tool-card-collapsed': isToolCollapsed(part) }"
                  >
                    <div class="tool-card-header">
                      <span class="tool-card-tag tag-result">Tool Result</span>
                      <div class="tool-card-lead">
                        <component
                          :is="getToolIconComponent(part)"
                          :size="16"
                          class="tool-card-lead-icon"
                        />
                        <span class="tool-card-title">{{ getToolTitle(part) }}</span>
                        <span class="tool-card-tool">{{ getToolName(part) }}</span>
                      </div>
                      <div class="tool-card-meta">
                        <span
                          v-if="getToolStateLabel(part)"
                          class="tool-state-pill"
                          :class="getToolStatePillClass(part)"
                        >
                          <CheckCircle
                            v-if="getToolStateKind(part) === 'success'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <XCircle
                            v-else-if="getToolStateKind(part) === 'error'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <ShieldBan
                            v-else-if="getToolStateKind(part) === 'denied'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <CircleHelp
                            v-else-if="getToolStateKind(part) === 'pending'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <Loader2
                            v-else-if="getToolStateKind(part) === 'running'"
                            :size="14"
                            class="tool-state-icon tool-icon-spin"
                          />
                          <span>{{ getToolStateLabel(part) }}</span>
                        </span>
                        <span v-if="getToolDurationLabel(part)" class="tool-duration">
                          <Clock :size="14" class="tool-duration-icon" />
                          <span>{{ getToolDurationLabel(part) }}</span>
                        </span>
                        <button
                          v-if="canToggleToolCollapse(part)"
                          type="button"
                          class="tool-collapse-btn"
                          :aria-label="isToolCollapsed(part) ? 'Expand tool details' : 'Collapse tool details'"
                          @click.stop="toggleToolCollapse(m as any, part as any)"
                        >
                          <ChevronDown
                            :size="16"
                            class="tool-collapse-icon"
                            :class="{ 'is-expanded': !isToolCollapsed(part) }"
                          />
                        </button>
                      </div>
                    </div>
                    <div v-if="!isToolCollapsed(part)">
                      <div v-if="hasWebSearchCitations(part)" class="tool-card-section">
                        <div class="tool-card-section-title">References</div>
                        <ol class="tool-citations">
                          <li v-for="citation in getWebSearchCitations(part)" :key="citation.url" class="tool-citation">
                            <a :href="citation.url" target="_blank" rel="noopener noreferrer">
                              {{ citation.title }}
                            </a>
                            <span v-if="citation.domain" class="tool-citation-domain">{{ citation.domain }}</span>
                          </li>
                        </ol>
                      </div>
                      <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
                        <div class="tool-card-section-title">{{ getToolInputDisplayTitle(part) }}</div>
                        <pre class="tool-json-output">{{ formatJson(getToolInputDisplayValue(part)) }}</pre>
                        <div v-if="getToolInputDisplayMetaText(part)" class="tool-input-meta">
                          {{ getToolInputDisplayMetaText(part) }}
                        </div>
                      </div>
                      <div v-if="hasDisplayValue(getToolOutput(part))" class="tool-card-section">
                        <div class="tool-card-section-title">Output</div>
                        <pre class="tool-json-output">{{ formatJson(getToolOutput(part)) }}</pre>
                      </div>
                    </div>
                  </div>
                  <div
                    v-else-if="isToolCallPart(part)"
                    class="tool-call-content"
                    :class="{ 'tool-card-collapsed': isToolCollapsed(part) }"
                  >
                    <div class="tool-card-header">
                      <span class="tool-card-tag tag-call">Tool Call</span>
                      <div class="tool-card-lead">
                        <component
                          :is="getToolIconComponent(part)"
                          :size="16"
                          class="tool-card-lead-icon"
                        />
                        <span class="tool-card-title">{{ getToolTitle(part) }}</span>
                        <span class="tool-card-tool">{{ getToolName(part) }}</span>
                      </div>
                      <div class="tool-card-meta">
                        <span
                          v-if="getToolStateLabel(part)"
                          class="tool-state-pill"
                          :class="getToolStatePillClass(part)"
                        >
                          <CheckCircle
                            v-if="getToolStateKind(part) === 'success'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <XCircle
                            v-else-if="getToolStateKind(part) === 'error'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <ShieldBan
                            v-else-if="getToolStateKind(part) === 'denied'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <CircleHelp
                            v-else-if="getToolStateKind(part) === 'pending'"
                            :size="14"
                            class="tool-state-icon"
                          />
                          <Loader2
                            v-else-if="getToolStateKind(part) === 'running'"
                            :size="14"
                            class="tool-state-icon tool-icon-spin"
                          />
                          <span>{{ getToolStateLabel(part) }}</span>
                        </span>
                        <span v-if="getToolDurationLabel(part)" class="tool-duration">
                          <Clock :size="14" class="tool-duration-icon" />
                          <span>{{ getToolDurationLabel(part) }}</span>
                        </span>
                        <button
                          v-if="canToggleToolCollapse(part)"
                          type="button"
                          class="tool-collapse-btn"
                          :aria-label="isToolCollapsed(part) ? 'Expand tool details' : 'Collapse tool details'"
                          @click.stop="toggleToolCollapse(m as any, part as any)"
                        >
                          <ChevronDown
                            :size="16"
                            class="tool-collapse-icon"
                            :class="{ 'is-expanded': !isToolCollapsed(part) }"
                          />
                        </button>
                      </div>
                    </div>
                    <div v-if="!isToolCollapsed(part)">
                      <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
                        <div class="tool-card-section-title">Arguments</div>
                        <pre class="tool-json-output">{{ formatJson(getToolInput(part)) }}</pre>
                      </div>
                    </div>
                  </div>
                  <div v-else class="tool-fallback-content">
                    <pre class="tool-json-output">{{ formatJson(part) }}</pre>
                  </div>
                </div>
                </div>
                <div v-if="m.role === 'user'" class="message-actions">
                  <button
                    class="message-action-btn"
                    type="button"
                    data-tooltip="Edit"
                    aria-label="Edit"
                    @click.stop="beginEditMessage(m as any)"
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
            <strong>Editing a previous message.</strong> Resending will remove later messages in this thread.
          </div>
          <button class="edit-banner-cancel" type="button" @click="cancelEditing">
            Cancel
          </button>
        </div>
        <ChatInput
          ref="chatInputRef"
          :chat="chat"
          :thread-id="currentThread?.id || ''"
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
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import {
  CheckCircle,
  ChevronDown,
  CircleHelp,
  Clock,
  FolderOpen,
  Loader2,
  Pencil,
  ShieldBan,
  XCircle,
} from 'lucide-vue-next';
import {
  canToggleToolCollapse,
  formatJson,
  getToolDurationLabel,
  getToolIconComponent,
  getToolInput,
  getToolInputDisplayMetaText,
  getToolInputDisplayTitle,
  getToolInputDisplayValue,
  getToolName,
  getToolOutput,
  getToolStateLabel,
  getToolStatePillClass,
  getToolTitle,
  getUsedToolNames,
  getWebSearchCitations,
  hasDisplayValue,
  hasWebSearchCitations,
  isApprovalRequestedPart,
  isToolCallPart,
  isToolCollapsed,
  isToolPart,
  isToolResultPart,
  toggleToolCollapse,
} from '../modules/chat/ui_message_tool_parts';
import { createUiMessagePersistence } from '../modules/chat/ui_message_persistence';
import { createChatUiStreamController } from '../modules/chat/ui_stream_controller';
import { parseStoredUiMessage } from '../modules/chat/ui_message_storage';
import {
  extractTextFromMessage,
  isTextPart,
  upsertTextIntoMessageParts,
} from '../modules/chat/ui_message_text';
import { useConfigStore } from '../store/config';
import VueMarkdown from 'vue-markdown-render';
import { markdownCodeBlockPlugin } from '../utils/markdown_code_block_plugin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const electronAPI = window.electronAPI as any;

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

interface ChatThread {
  id: string;
  title: string;
  model?: string;
}

const showWelcome = ref(true);
// Create Chat instance for message management (without API endpoint for Electron)
const chat = new Chat({});
const messagesContainer = ref<HTMLElement | null>(null);
const currentThread = ref<ChatThread | null>(null);
const currentModel = ref<string>('');
const selectedTools = ref<string[]>([]);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const chatInputRef = ref<any>(null);
const persistence = createUiMessagePersistence({ electronAPI });
const TITLE_REGEN_INTERVAL = 2;
const editingUserMessageId = ref<string | null>(null);

const createMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const markdownPlugins = [markdownCodeBlockPlugin];

const truncateConversationAfterIndex = async (messageIndex: number) => {
  await persistence.truncateConversationAfterIndex({ chat, messageIndex });
};

const beginEditMessage = async (message: UIMessage) => {
  if (!message || message.role !== 'user' || typeof message.id !== 'string') return;
  await streamController.stopActiveStreamIfNeeded('edit-message');
  editingUserMessageId.value = message.id;
  const text = extractTextFromMessage(message);
  await chatInputRef.value?.setDraftMessage(text, { focus: true, select: true });
  scrollToBottom();
};

const cancelEditing = async () => {
  editingUserMessageId.value = null;
  await chatInputRef.value?.setDraftMessage('', { focus: true });
};

const upsertUiMessage = async (
  message: UIMessage,
  parentId?: string,
  source = 'unknown',
  threadIdOverride?: string
) => {
  const threadId = threadIdOverride || currentThread.value?.id || '';
  if (!threadId) return;

  await persistence.upsertUiMessage({
    message,
    threadId,
    parentId,
    source,
  });
};

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getPartRenderKey = (messageId: string, part: unknown, partIndex: number): string => {
  const partType = getPartType(part);
  if (isTextPart(part)) {
    return `${messageId}-${partType}-${partIndex}-${part.text.length}-${streamController.streamRenderTick.value}`;
  }
  return `${messageId}-${partType}-${partIndex}`;
};

const isStreamingTextPart = (message: UIMessage, part: unknown): boolean => {
  if (!isTextPart(part)) return false;
  if (!streamController.activeAssistantMessageId.value) return false;
  if (message.id !== streamController.activeAssistantMessageId.value) return false;
  return isObjectRecord(part) && part.state === 'streaming';
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

const streamController = createChatUiStreamController({
  chat,
  electronAPI,
  persistence,
  createMessageId,
  scrollToBottom,
  getCurrentThreadId: () => currentThread.value?.id || null,
  onAssistantMessagePersisted: async ({ threadId, messagesSnapshot }) => {
    if (!currentThread.value || currentThread.value.id !== threadId) return;

    if (
      messagesSnapshot.length > 0 &&
      shouldRegenerateThreadTitle(messagesSnapshot, currentThread.value.title)
    ) {
      const generatedTitle = await generateThreadTitle(messagesSnapshot);
      if (generatedTitle) {
        await updateThreadTitleById(threadId, generatedTitle);
      }
    }
  },
});

const isApprovalProcessing = streamController.isApprovalProcessing;
const handleToolApproval = streamController.handleToolApproval;

const createNewThread = async (model?: string) => {
  try {
    const thread = await electronAPI.chat.threads.create({
      title: 'New Chat',
      model: model || null,
      metadata: JSON.stringify({}),
    });
    currentThread.value = thread;
    chat.messages.splice(0, chat.messages.length);
    persistence.resetPersistedMessageIds();
    editingUserMessageId.value = null;
    streamController.resetTransientState();
    showWelcome.value = false;

    // Refresh sidebar to show new thread
    if (sidebarRef.value?.refresh) {
      await sidebarRef.value.refresh();
    }
    if (sidebarRef.value?.setCurrentThread) {
      sidebarRef.value.setCurrentThread(thread.id);
    }

    return thread;
  } catch (error) {
    console.error('Failed to create thread:', error);
    return null;
  }
};

// Load messages for a thread
const loadThreadMessages = async (threadId: string) => {
  try {
    const dbMessages = await electronAPI.chat.messages.list(threadId);
    persistence.resetPersistedMessageIds(
      Array.isArray(dbMessages)
        ? dbMessages
            .map((message: any) => (message && typeof message.id === 'string' ? message.id : ''))
            .filter((id: string) => id.length > 0)
        : []
    );

    const chatMessages = dbMessages.map((message: any) => parseStoredUiMessage(message));
    chat.messages.splice(0, chat.messages.length, ...(chatMessages as any[]));
    editingUserMessageId.value = null;
    streamController.resetTransientState();
    scrollToBottom();
  } catch (error) {
    console.error('Failed to load thread messages:', error);
  }
};

// Select a thread
const selectThread = async (threadId: string) => {
  try {
    if (currentThread.value?.id === threadId) {
      return;
    }

    await streamController.stopActiveStreamIfNeeded('switch-thread', threadId);

    const thread = await electronAPI.chat.threads.get(threadId);
    if (!thread) {
      console.error('Thread not found:', threadId);
      return;
    }

    currentThread.value = thread;
    showWelcome.value = false;
    await loadThreadMessages(threadId);

    // Update sidebar current thread
    if (sidebarRef.value?.setCurrentThread) {
      sidebarRef.value.setCurrentThread(threadId);
    }
  } catch (error) {
    console.error('Failed to select thread:', error);
  }
};

const handleThreadDeleted = async (threadId: string) => {
  if (currentThread.value?.id !== threadId) return;

  await streamController.stopActiveStreamIfNeeded('delete-thread');
  currentThread.value = null;
  currentModel.value = '';
  chat.messages.splice(0, chat.messages.length);
  persistence.resetPersistedMessageIds();
  editingUserMessageId.value = null;
  streamController.resetTransientState();
  showWelcome.value = true;

  if (sidebarRef.value?.setCurrentThread) {
    sidebarRef.value.setCurrentThread(null);
  }
};

// Refresh threads list
const refreshThreads = async () => {
  if (sidebarRef.value?.refresh) {
    await sidebarRef.value.refresh();
  }
};

const updateThreadTitle = async (title: string) => {
  if (!currentThread.value) return;
  if (currentThread.value.title === title) return;

  try {
    await electronAPI.chat.threads.update(currentThread.value.id, { title });
    if (currentThread.value) {
      currentThread.value.title = title;
    }
    // Refresh sidebar to show updated title
    await refreshThreads();
  } catch (error) {
    console.error('Failed to update thread title:', error);
  }
};

const updateThreadTitleById = async (threadId: string, title: string) => {
  if (!threadId || !title.trim()) return;

  if (currentThread.value?.id === threadId) {
    await updateThreadTitle(title);
    return;
  }

  try {
    await electronAPI.chat.threads.update(threadId, { title });
    await refreshThreads();
  } catch (error) {
    console.error('Failed to update thread title by id:', error);
  }
};

const getConversationContentForTitle = (messages: UIMessage[]): string => {
  const lines: string[] = [];

  for (const message of messages) {
    const text = extractTextFromMessage(message).trim();
    if (!text) continue;

    const role =
      message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User';
    lines.push(`${role}: ${text}`);
  }

  return lines.join('\n');
};

const getFallbackThreadTitle = (messages: UIMessage[]): string | null => {
  const latestUserText = [...messages]
    .reverse()
    .filter(message => message.role === 'user')
    .map(message => extractTextFromMessage(message).trim())
    .find(text => text.length > 0);
  const fallbackText = latestUserText || extractTextFromMessage(messages[0]).trim();
  if (!fallbackText) return null;
  return fallbackText.slice(0, 50) + (fallbackText.length > 50 ? '...' : '');
};

const shouldRegenerateThreadTitle = (messages: UIMessage[], currentTitle: string): boolean => {
  const assistantMessageCount = messages.filter(message => message.role === 'assistant').length;
  if (assistantMessageCount === 0) return false;
  if (currentTitle === 'New Chat') return true;
  return assistantMessageCount % TITLE_REGEN_INTERVAL === 0;
};

// Generate thread title using full conversation context
const generateThreadTitle = async (messages: UIMessage[]): Promise<string | null> => {
  try {
    const conversationContent = getConversationContentForTitle(messages);
    if (!conversationContent.trim()) {
      return getFallbackThreadTitle(messages);
    }

    const title = await electronAPI.toolModel.generateTitle(conversationContent);
    return title || getFallbackThreadTitle(messages);
  } catch (error) {
    console.error('Failed to generate thread title with agent:', error);
    return getFallbackThreadTitle(messages);
  }
};

const handleNewChat = async () => {
  await streamController.stopActiveStreamIfNeeded('new-chat');
  await createNewThread(currentModel.value);
};

const handleModelSelected = (data: { provider: any; model: string }) => {
  currentModel.value = data.model;
  // Update thread model if thread exists
  if (currentThread.value) {
    electronAPI.chat.threads.update(currentThread.value.id, { model: data.model });
  }
};

const handleMessageSent = async (
  content: string,
  model?: string,
  tools?: string[],
  onReady?: () => void
) => {
  try {
    const pendingEditMessageId = editingUserMessageId.value;

    // Create thread if it doesn't exist
    if (!currentThread.value) {
      const thread = await createNewThread(model || currentModel.value);
      if (!thread) {
        console.error('Failed to create thread');
        return;
      }
    }

    if (!currentThread.value) {
      console.error('No thread available');
      return;
    }

    // Update thread model if provided
    if (model && currentThread.value.model !== model) {
      await electronAPI.chat.threads.update(currentThread.value.id, { model });
      currentThread.value.model = model;
      currentModel.value = model;
    }

    // Store selected tools
    if (tools) {
      selectedTools.value = tools;
    }

    showWelcome.value = false;

    if (pendingEditMessageId && currentThread.value) {
      await streamController.stopActiveStreamIfNeeded('edit-resend');

      const messageIndex = chat.messages.findIndex(
        (message: any) => message && message.id === pendingEditMessageId
      );

      if (messageIndex >= 0) {
        const currentUserMessage = chat.messages[messageIndex] as UIMessage;
        const updatedUserMessage: UIMessage = {
          ...currentUserMessage,
          parts: upsertTextIntoMessageParts(currentUserMessage.parts, content),
        };

        chat.messages.splice(messageIndex, 1, updatedUserMessage as any);
        await upsertUiMessage(updatedUserMessage, undefined, 'user-message-edit', currentThread.value.id);
        await truncateConversationAfterIndex(messageIndex);

        streamController.beginTurn({
          threadId: currentThread.value.id,
          parentId: updatedUserMessage.id,
          tracePrefix: 'view',
        });

        editingUserMessageId.value = null;
        scrollToBottom();
        return;
      }

      editingUserMessageId.value = null;
    }

    const userMessage: UIMessage = {
      id: createMessageId(),
      role: 'user',
      parts: [{ type: 'text', text: content, state: 'done' }],
    };

    chat.messages.push(userMessage as any);
    const threadId = currentThread.value.id;
    streamController.beginTurn({
      threadId,
      parentId: userMessage.id,
      tracePrefix: 'view',
    });
    await upsertUiMessage(userMessage, undefined, 'user-message', threadId);

    scrollToBottom();
  } finally {
    onReady?.();
  }
};

// Listen for model selection from ChatInput
onMounted(async () => {
  // Initialize config store if not already initialized
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  // Load threads on mount
  await refreshThreads();

  electronAPI.chat.removeAllListeners();
  electronAPI.chat.onUiChunk((chunk: unknown) => {
    void streamController.handleUiChunk(chunk);
  });
});

onUnmounted(() => {
  electronAPI.chat.removeAllListeners();
});
</script>

<style scoped>
.app-background {
  background-color: var(--bg-primary);
}

.app-text {
  color: var(--text-primary);
}

.text-secondary {
  color: var(--text-secondary);
}

.text-muted {
  color: var(--text-muted);
}

/* Messages styles */
.messages-area {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.chat-main-area {
  padding: var(--chat-content-padding, 24px);
}

.messages-container {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
}

.message-wrapper {
  margin-bottom: var(--chat-message-gap, 18px);
}

.message-shell {
  position: relative;
}

.tool-usage-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.tool-usage-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tool-usage-pill {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
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
  transition: opacity 0.15s ease, transform 0.15s ease;
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
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.18);
  color: var(--text-primary);
  font-size: 12px;
  letter-spacing: 0.01em;
  opacity: 0;
  transform: translate(-50%, 4px);
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
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
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-tertiary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
  border-radius: 12px;
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
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
  transition: color 0.2s ease, border-color 0.2s ease;
}

.message-text.markdown-content :deep(a:hover) {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
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

.tool-approval-content,
.tool-call-content,
.tool-result-content,
.tool-fallback-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px;
  max-width: 680px;
}

.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.tool-card-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 999px;
  padding: 2px 8px;
}

.tag-call {
  color: var(--accent-color);
  background: var(--bg-tertiary);
}

.tag-result {
  color: var(--success-color, var(--accent-color));
  background: var(--bg-tertiary);
}

.tool-card-lead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.tool-card-lead-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.tool-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-card-tool {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
}

.tool-card-meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  white-space: nowrap;
}

.tool-state-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.tool-state-pill.tool-state-success {
  color: var(--success-color, var(--accent-color));
  border-color: color-mix(
    in srgb,
    var(--success-color, var(--accent-color)) 55%,
    var(--border-color)
  );
  background: color-mix(in srgb, var(--success-color, var(--accent-color)) 12%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-error {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 10%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-denied {
  color: var(--text-muted);
  border-color: color-mix(in srgb, var(--text-muted) 55%, var(--border-color));
  background: color-mix(in srgb, var(--text-muted) 10%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-pending,
.tool-state-pill.tool-state-running {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-tertiary));
}

.tool-state-icon {
  opacity: 0.95;
}

.tool-icon-spin {
  animation: tool-spin 0.9s linear infinite;
}

@keyframes tool-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.tool-duration {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.9;
}

.tool-duration-icon {
  opacity: 0.85;
}

.tool-input-meta {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.tool-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.tool-collapse-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-color);
  color: var(--text-primary);
}

.tool-collapse-icon {
  transition: transform 0.18s ease;
}

.tool-collapse-icon.is-expanded {
  transform: rotate(180deg);
}

.tool-card-collapsed .tool-card-header {
  margin-bottom: 0;
}

.tool-card-section + .tool-card-section {
  margin-top: 10px;
}

.tool-card-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tool-citations {
  margin: 0;
  padding-left: 18px;
  color: var(--text-primary);
  display: grid;
  gap: 6px;
}

.tool-citation {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}

.tool-citation a {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent-color) 55%, transparent);
  transition: color 0.2s ease, border-color 0.2s ease;
}

.tool-citation a:hover {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}

.tool-citation-domain {
  margin-left: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.tool-json-output {
  margin: 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.tool-approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.tool-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-color);
}

.tool-approval-title {
  font-size: 14px;
}

.tool-approval-body {
  margin-bottom: 12px;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.tool-args {
  margin: 0;
}

.tool-args pre {
  margin: 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  overflow-x: auto;
  white-space: pre;
}

.tool-approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.approve-btn,
.reject-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.approve-btn {
  background: var(--accent-color);
  color: white;
}

.approve-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.reject-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.reject-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.approve-btn:disabled,
.reject-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
