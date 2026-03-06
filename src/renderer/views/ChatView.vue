<template>
  <div class="flex h-screen app-background app-text">
    <Sidebar ref="sidebarRef" @thread-selected="selectThread" @new-chat="handleNewChat" />

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
      <div class="flex flex-1 items-center justify-center p-8 overflow-y-auto" ref="messagesContainer">
        <WelcomeScreen v-if="showWelcome && chat.messages.length === 0" @new-chat="handleNewChat" />

        <!-- Messages List -->
        <div v-else class="messages-area w-full h-full">
          <div class="messages-container">
            <div v-for="(m, index) in chat.messages" :key="m.id ? m.id : index" class="message-wrapper" :class="m.role">
              <div class="message-content">
                <div v-for="(part, partIndex) in m.parts" :key="`${m.id}-${part.type}-${partIndex}`">
                  <div v-if="part.type === 'text'" class="message-text markdown-content">
                    <VueMarkdown :source="(part as any).text" />
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
                        <pre>{{ JSON.stringify(getToolInput(part), null, 2) }}</pre>
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
                  <div v-else-if="isToolPart(part)" class="message-text">
                    <pre>{{ JSON.stringify(part, null, 2) }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <ChatInput :chat="chat" @message-sent="handleMessageSent" @response-received="handleResponseReceived"
        @stream-chunk="handleStreamChunk" @model-selected="handleModelSelected" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';
import { ref, nextTick, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import { FolderOpen } from 'lucide-vue-next';
import { useConfigStore } from '../store/config';
import VueMarkdown from 'vue-markdown-render';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

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
const activeAssistantMessageId = ref<string | null>(null);
const activeAssistantParentId = ref<string | null>(null);
const approvalProcessing = ref<Record<string, boolean>>({});
const persistedMessageIds = new Set<string>();

const createMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRole = (role: unknown): 'system' | 'user' | 'assistant' => {
  if (role === 'system' || role === 'assistant' || role === 'user') {
    return role;
  }
  return 'user';
};

const normalizeParts = (parts: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    part => isObjectRecord(part) && typeof part.type === 'string'
  ) as Array<Record<string, unknown>>;
};

const parseStoredUiMessage = (row: { id: string; message: string }): UIMessage => {
  try {
    const parsed = JSON.parse(row.message);
    if (isObjectRecord(parsed)) {
      if (Array.isArray(parsed.parts)) {
        const parsedParts = normalizeParts(parsed.parts);
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts:
            parsedParts.length > 0
              ? (parsedParts as UIMessage['parts'])
              : ([{ type: 'text', text: '' }] as UIMessage['parts']),
        };
      }

      if (typeof parsed.content === 'string') {
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts: [{ type: 'text', text: parsed.content }],
        };
      }
    }
  } catch {
    // Fallback below.
  }

  return {
    id: row.id,
    role: 'user',
    parts: [{ type: 'text', text: row.message }],
  };
};

const extractTextFromMessage = (message: UIMessage | undefined): string => {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter(part => isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map(part => String(part.text))
    .join('');
};

const upsertUiMessage = async (message: UIMessage, parentId?: string) => {
  if (!currentThread.value) return;

  const serializedMessage = JSON.stringify(message);
  const metadata = JSON.stringify({ format: 'ai-ui-message-v1' });

  if (persistedMessageIds.has(message.id)) {
    await window.electronAPI.chat.messages.update(message.id, {
      message: serializedMessage,
      metadata,
    });
    return;
  }

  const savedMessage = await window.electronAPI.chat.messages.create({
    id: message.id,
    thread_id: currentThread.value.id,
    parent_id: parentId || null,
    depth: 0,
    message: serializedMessage,
    timestamp: new Date().toISOString(),
    metadata,
  });

  if (savedMessage?.id) {
    message.id = savedMessage.id;
    persistedMessageIds.add(savedMessage.id);
  } else {
    persistedMessageIds.add(message.id);
  }
};

const getAssistantMessageById = (id: string | null): UIMessage | undefined => {
  if (!id) return undefined;
  return chat.messages.find((message: any) => message.id === id) as UIMessage | undefined;
};

const getOrCreateAssistantMessage = (): UIMessage => {
  const existing = getAssistantMessageById(activeAssistantMessageId.value);
  if (existing) return existing;

  const assistantMessage: UIMessage = {
    id: createMessageId(),
    role: 'assistant',
    parts: [],
  };

  chat.messages.push(assistantMessage as any);
  activeAssistantMessageId.value = assistantMessage.id;
  return assistantMessage;
};

const getApprovalId = (part: unknown): string | null => {
  if (!isObjectRecord(part) || !isObjectRecord(part.approval)) return null;
  return typeof part.approval.id === 'string' ? part.approval.id : null;
};

const isToolPart = (part: unknown): boolean =>
  isObjectRecord(part) &&
  typeof part.type === 'string' &&
  (part.type === 'dynamic-tool' || part.type.startsWith('tool-'));

const isApprovalRequestedPart = (part: unknown): boolean =>
  isToolPart(part) &&
  isObjectRecord(part) &&
  part.state === 'approval-requested' &&
  getApprovalId(part) !== null;

const getToolName = (part: unknown): string => {
  if (!isObjectRecord(part)) return 'tool';
  if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') {
    return part.toolName;
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.replace(/^tool-/, '');
  }
  return 'tool';
};

const getToolInput = (part: unknown): unknown => {
  if (!isObjectRecord(part)) return {};
  return part.input ?? {};
};

const isApprovalProcessing = (part: unknown): boolean => {
  const approvalId = getApprovalId(part);
  return approvalId ? !!approvalProcessing.value[approvalId] : false;
};

const resetTransientState = () => {
  activeAssistantMessageId.value = null;
  activeAssistantParentId.value = null;
  approvalProcessing.value = {};
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const createNewThread = async (model?: string) => {
  try {
    const thread = await window.electronAPI.chat.threads.create({
      title: 'New Chat',
      model: model || null,
      metadata: JSON.stringify({}),
    });
    currentThread.value = thread;
    chat.messages.splice(0, chat.messages.length);
    persistedMessageIds.clear();
    resetTransientState();
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
    const dbMessages = await window.electronAPI.chat.messages.list(threadId);
    persistedMessageIds.clear();
    for (const message of dbMessages) {
      persistedMessageIds.add(message.id);
    }

    const chatMessages = dbMessages.map((message: any) => parseStoredUiMessage(message));
    chat.messages.splice(0, chat.messages.length, ...(chatMessages as any[]));
    resetTransientState();
    scrollToBottom();
  } catch (error) {
    console.error('Failed to load thread messages:', error);
  }
};

// Select a thread
const selectThread = async (threadId: string) => {
  try {
    const thread = await window.electronAPI.chat.threads.get(threadId);
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

// Refresh threads list
const refreshThreads = async () => {
  if (sidebarRef.value?.refresh) {
    await sidebarRef.value.refresh();
  }
};

const updateThreadTitle = async (title: string) => {
  if (!currentThread.value) return;

  try {
    await window.electronAPI.chat.threads.update(currentThread.value.id, { title });
    if (currentThread.value) {
      currentThread.value.title = title;
    }
    // Refresh sidebar to show updated title
    await refreshThreads();
  } catch (error) {
    console.error('Failed to update thread title:', error);
  }
};

// Generate thread title using Agent framework
const generateThreadTitle = async (
  userMessage: string,
  assistantMessage?: string
): Promise<string | null> => {
  try {
    // Build conversation content for title generation
    const conversationContent = assistantMessage
      ? `User: ${userMessage}\nAssistant: ${assistantMessage}`
      : `User: ${userMessage}`;

    // Use agent to generate title
    const title = await window.electronAPI.toolModel.generateTitle(conversationContent);

    if (title) {
      return title;
    }

    // Fallback to simple truncation if agent generation fails
    return userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
  } catch (error) {
    console.error('Failed to generate thread title with agent:', error);
    // Fallback to simple truncation
    return userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
  }
};

const handleNewChat = async () => {
  await createNewThread(currentModel.value);
};

const handleModelSelected = (data: { provider: any; model: string }) => {
  currentModel.value = data.model;
  // Update thread model if thread exists
  if (currentThread.value) {
    window.electronAPI.chat.threads.update(currentThread.value.id, { model: data.model });
  }
};

const handleMessageSent = async (content: string, model?: string, tools?: string[]) => {
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
    await window.electronAPI.chat.threads.update(currentThread.value.id, { model });
    currentThread.value.model = model;
    currentModel.value = model;
  }

  // Store selected tools
  if (tools) {
    selectedTools.value = tools;
  }

  showWelcome.value = false;

  const userMessage: UIMessage = {
    id: createMessageId(),
    role: 'user',
    parts: [{ type: 'text', text: content, state: 'done' }],
  };

  chat.messages.push(userMessage as any);
  activeAssistantParentId.value = userMessage.id;
  activeAssistantMessageId.value = null;
  await upsertUiMessage(userMessage);

  scrollToBottom();
};

const handleStreamChunk = (chunk: string) => {
  const assistantMessage = getOrCreateAssistantMessage();
  const textPart = assistantMessage.parts.find(
    part => isObjectRecord(part) && part.type === 'text'
  ) as Record<string, unknown> | undefined;

  if (textPart && typeof textPart.text === 'string') {
    textPart.text += chunk;
    textPart.state = 'streaming';
  } else {
    assistantMessage.parts.push({
      type: 'text',
      text: chunk,
      state: 'streaming',
    } as any);
  }

  scrollToBottom();
};

const handleResponseReceived = async (fullText: string) => {
  if (!currentThread.value) return;

  const assistantMessage = getOrCreateAssistantMessage();
  const textPart = assistantMessage.parts.find(
    part => isObjectRecord(part) && part.type === 'text'
  ) as Record<string, unknown> | undefined;

  if (textPart) {
    textPart.text = fullText;
    textPart.state = 'done';
  } else if (fullText) {
    assistantMessage.parts.push({
      type: 'text',
      text: fullText,
      state: 'done',
    } as any);
  }

  await upsertUiMessage(assistantMessage, activeAssistantParentId.value || undefined);

  const parentUserMessage = activeAssistantParentId.value
    ? (chat.messages.find((message: any) => message.id === activeAssistantParentId.value) as
        | UIMessage
        | undefined)
    : (chat.messages.filter((message: any) => message.role === 'user').pop() as UIMessage | undefined);

  // Generate thread title using Tool Model if it's still "New Chat" and this is the first exchange
  if (currentThread.value.title === 'New Chat' && chat.messages.length === 2) {
    const userMessageText = extractTextFromMessage(parentUserMessage);
    const generatedTitle = await generateThreadTitle(userMessageText, fullText);
    if (generatedTitle) {
      await updateThreadTitle(generatedTitle);
    }
  }

  resetTransientState();
  scrollToBottom();
};

const handleToolApprovalRequest = async (request: any) => {
  const assistantMessage = getOrCreateAssistantMessage();
  const existing = assistantMessage.parts.find(
    part => getApprovalId(part) === request.approvalId
  );
  if (existing) return;

  assistantMessage.parts.push({
    type: 'dynamic-tool',
    toolName: request.toolCall?.toolName || 'tool',
    toolCallId: request.toolCallId || request.toolCall?.toolCallId || createMessageId(),
    input: request.toolCall?.args ?? {},
    state: 'approval-requested',
    approval: {
      id: request.approvalId,
    },
  } as any);

  await upsertUiMessage(assistantMessage, activeAssistantParentId.value || undefined);
  scrollToBottom();
};

const handleToolApproval = async (message: UIMessage, part: any, approved: boolean) => {
  const approvalId = getApprovalId(part);
  if (!approvalId) return;

  approvalProcessing.value[approvalId] = true;

  try {
    const result = await window.electronAPI.chat.approveTool(approvalId, approved);
    if (!result?.success) {
      throw new Error(result?.error || 'Tool approval failed');
    }

    if (approved) {
      part.state = 'approval-responded';
      part.approval = {
        id: approvalId,
        approved: true,
        reason: 'User approved tool execution.',
      };
    } else {
      part.state = 'output-denied';
      part.approval = {
        id: approvalId,
        approved: false,
        reason: 'User rejected tool execution.',
      };
    }

    await upsertUiMessage(message, activeAssistantParentId.value || undefined);
  } catch (error) {
    console.error('Failed to approve tool:', error);
  } finally {
    approvalProcessing.value[approvalId] = false;
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

  // Setup tool approval request listener
  window.electronAPI.chat.onToolApprovalRequest((request: any) => {
    void handleToolApprovalRequest(request);
  });
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

.messages-container {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.message-wrapper {
  margin-bottom: 16px;
}

.message-wrapper.user .message-content {
  background: var(--bg-tertiary);
  border-radius: 12px;
  padding: 12px 16px;
  margin-left: auto;
  width: fit-content;
  max-width: 85%;
}

.message-wrapper.assistant .message-content {
  background: var(--bg-primary);
  border-radius: 12px;
  padding: 12px 16px;
  margin-right: 60px;
}

.message-text {
  line-height: 1.5;
  white-space: pre-wrap;
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

/* Tool Approval Styles */
.message-wrapper.tool-approval {
  margin-bottom: 16px;
}

.tool-approval-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  max-width: 600px;
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
  font-weight: 600;
  color: var(--accent-color);
  margin-bottom: 8px;
  font-size: 14px;
}

.tool-args {
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  overflow-x: auto;
}

.tool-args pre {
  margin: 0;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
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
