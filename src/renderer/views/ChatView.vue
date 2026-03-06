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
                  <div v-else-if="
                    part.type === 'tool-call' || part.type?.toString().startsWith('tool-')
                  " class="message-text">
                    <pre>{{ JSON.stringify(part, null, 2) }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tool Approval Requests -->
            <div v-for="(approval, index) in pendingToolApprovals" :key="approval.approvalId"
              class="message-wrapper tool-approval">
              <div class="message-content tool-approval-content">
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
                    {{ approval.toolCall?.toolName || `Tool Call ${approval.toolCallId || approval.approvalId}` }}
                  </div>
                  <div class="tool-args">
                    <pre>{{ JSON.stringify(approval.toolCall?.args || { toolCallId: approval.toolCallId }, null, 2) }}</pre>
                  </div>
                </div>
                <div class="tool-approval-actions">
                  <button class="approve-btn" @click="handleToolApproval(approval.approvalId, true)"
                    :disabled="approval.processing">
                    Approve
                  </button>
                  <button class="reject-btn" @click="handleToolApproval(approval.approvalId, false)"
                    :disabled="approval.processing">
                    Reject
                  </button>
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
import { ref, nextTick, onMounted, computed } from 'vue';
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

const isSidebarOpen = ref(true);
const showWelcome = ref(true);
// Create Chat instance for message management (without API endpoint for Electron)
const chat = new Chat({});
const messagesContainer = ref<HTMLElement | null>(null);
const currentThread = ref<ChatThread | null>(null);
const currentModel = ref<string>('');
const selectedProviderType = ref<string>('');
const selectedTools = ref<string[]>([]);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const pendingToolApprovals = ref<
  Array<{
    approvalId: string;
    toolCallId?: string;
    toolCall?: { toolName: string; args: any };
    processing?: boolean;
  }>
>([]);

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
    // Convert database messages to Chat format
    const chatMessages = dbMessages.map((msg: any) => {
      try {
        const messageData = JSON.parse(msg.message);
        return {
          id: msg.id,
          role: messageData.role,
          parts: [{ type: 'text' as const, text: messageData.content }],
        };
      } catch {
        return {
          id: msg.id,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: msg.message }],
        };
      }
    });
    // Set messages in Chat instance
    chat.messages.splice(0, chat.messages.length, ...chatMessages);
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

// Functions are now handled via events from Sidebar

const saveMessage = async (role: 'user' | 'assistant', content: string, parentId?: string) => {
  if (!currentThread.value) return null;

  try {
    const messageData = {
      thread_id: currentThread.value.id,
      parent_id: parentId || null,
      depth: 0,
      message: JSON.stringify({ role, content }),
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({}),
    };

    const savedMessage = await window.electronAPI.chat.messages.create(messageData);
    return savedMessage;
  } catch (error) {
    console.error('Failed to save message:', error);
    return null;
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

// Get Tool Model configuration (with auto-detection) - uses backend implementation
const getToolModel = async (): Promise<{ providerType: string; model: string } | null> => {
  try {
    return await window.electronAPI.toolModel.get();
  } catch (error) {
    console.error('Failed to get tool model:', error);
    return null;
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
  selectedProviderType.value = data.provider?.type || '';
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

  // Save user message
  const userMessage = await saveMessage('user', content);

  // Manually add user message to Chat instance (don't use sendMessage as it triggers HTTP request)
  chat.messages.push({
    id: userMessage?.id,
    role: 'user',
    parts: [{ type: 'text', text: content }] as any,
  });

  scrollToBottom();
};

const handleStreamChunk = (chunk: string) => {
  // Update the last assistant message in Chat instance
  const lastMessage = chat.messages[chat.messages.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    const textPart = lastMessage.parts.find((p: any) => p.type === 'text') as any;
    if (textPart && 'text' in textPart) {
      textPart.text += chunk;
    } else {
      lastMessage.parts.push({ type: 'text', text: chunk } as any);
    }
  } else {
    // Create new assistant message if it doesn't exist
    chat.messages.push({
      id: undefined,
      role: 'assistant',
      parts: [{ type: 'text', text: chunk }] as any,
    });
  }
  scrollToBottom();
};

const handleResponseReceived = async (fullText: string) => {
  if (!currentThread.value) return;

  // Get the last user message ID as parent
  const lastUserMessage = chat.messages.filter((m: any) => m.role === 'user').pop();
  const parentId = lastUserMessage?.id || null;

  // Save assistant message
  await saveMessage('assistant', fullText, parentId || undefined);

  // Ensure assistant message exists in chat.messages with correct content
  const lastAssistantMessage = chat.messages[chat.messages.length - 1];
  if (lastAssistantMessage && lastAssistantMessage.role === 'assistant') {
    const textPart = lastAssistantMessage.parts.find((p: any) => p.type === 'text') as any;
    if (textPart && 'text' in textPart) {
      textPart.text = fullText;
    }
  } else {
    chat.messages.push({
      id: undefined,
      role: 'assistant',
      parts: [{ type: 'text', text: fullText }] as any,
    });
  }

  // Generate thread title using Tool Model if it's still "New Chat" and this is the first exchange
  if (currentThread.value.title === 'New Chat' && chat.messages.length === 2) {
    const textPart = lastUserMessage?.parts?.find((p: any) => p.type === 'text') as any;
    const userMessageText = textPart && 'text' in textPart ? textPart.text : '';
    const generatedTitle = await generateThreadTitle(userMessageText, fullText);
    if (generatedTitle) {
      await updateThreadTitle(generatedTitle);
    }
  }

  scrollToBottom();
};

const handleToolApprovalRequest = (request: any) => {
  pendingToolApprovals.value.push({
    approvalId: request.approvalId,
    toolCallId: request.toolCallId,
    toolCall: request.toolCall,
    processing: false,
  });
  scrollToBottom();
};

const handleToolApproval = async (approvalId: string, approved: boolean) => {
  const approval = pendingToolApprovals.value.find(a => a.approvalId === approvalId);
  if (!approval) return;

  approval.processing = true;

  try {
    const result = await window.electronAPI.chat.approveTool(approvalId, approved);
    if (!result?.success) {
      throw new Error(result?.error || 'Tool approval failed');
    }
    // Remove the approval request from the list
    const index = pendingToolApprovals.value.findIndex(a => a.approvalId === approvalId);
    if (index !== -1) {
      pendingToolApprovals.value.splice(index, 1);
    }
  } catch (error) {
    console.error('Failed to approve tool:', error);
    approval.processing = false;
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
    handleToolApprovalRequest(request);
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
