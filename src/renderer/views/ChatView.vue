<template>
  <div class="flex h-screen app-background app-text">
    <Sidebar ref="sidebarRef" @thread-selected="selectThread" @new-chat="handleNewChat" />

    <!-- Main Content -->
    <div class="flex flex-1 flex-col">
      <!-- Header -->
      <div class="flex items-center justify-center p-4">
        <div class="flex items-center gap-1 text-sm text-secondary">
          <span>{{ messages.length }} messages</span>
          <span v-if="currentThread">·</span>
          <FolderOpen v-if="currentThread" :size="12" />
          <span v-if="currentThread">{{ currentThread.title }}</span>
        </div>
      </div>

      <!-- Main Area -->
      <div
        class="flex flex-1 items-center justify-center p-8 overflow-y-auto"
        ref="messagesContainer"
      >
        <WelcomeScreen v-if="showWelcome && messages.length === 0" @new-chat="handleNewChat" />

        <!-- Messages List -->
        <div v-else class="messages-area w-full h-full">
          <div class="messages-container">
            <div
              v-for="(msg, index) in messages"
              :key="index"
              class="message-wrapper"
              :class="msg.role"
            >
              <div class="message-content">
                <div class="message-text">{{ msg.content }}</div>
              </div>
            </div>

            <!-- Streaming response -->
            <div v-if="isStreaming" class="message-wrapper assistant">
              <div class="message-content">
                <div class="message-text"><span class="typing">typing...</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <ChatInput
        @message-sent="handleMessageSent"
        @response-received="handleResponseReceived"
        @stream-chunk="handleStreamChunk"
        @model-selected="handleModelSelected"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import { FileArchive, FileBox, FolderOpen } from 'lucide-vue-next';
import { useConfigStore } from '../store/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  id?: string;
}

interface ChatThread {
  id: string;
  title: string;
  model?: string;
}

const isSidebarOpen = ref(true);
const showWelcome = ref(true);
const messages = ref<ChatMessage[]>([]);
const messagesContainer = ref<HTMLElement | null>(null);
const isStreaming = ref(false);
const streamingContent = ref('');
const currentThread = ref<ChatThread | null>(null);
const currentModel = ref<string>('');
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);

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
    messages.value = [];
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
    messages.value = dbMessages.map((msg: any) => {
      try {
        const messageData = JSON.parse(msg.message);
        return {
          id: msg.id,
          role: messageData.role,
          content: messageData.content,
        };
      } catch {
        return {
          id: msg.id,
          role: 'user' as const,
          content: msg.message,
        };
      }
    });
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

// Generate thread title using Tool Model
const generateThreadTitle = async (
  userMessage: string,
  assistantMessage?: string
): Promise<string | null> => {
  try {
    const toolModel = await getToolModel();
    if (!toolModel) {
      console.warn('No tool model available, using fallback title');
      return userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
    }

    // Create prompt for title generation
    const prompt = assistantMessage
      ? `Generate a concise, descriptive title (max 60 characters) for this conversation based on the user's message and assistant's response. Title only, no quotes or extra text.\n\nUser: ${userMessage}\nAssistant: ${assistantMessage}`
      : `Generate a concise, descriptive title (max 60 characters) for this conversation based on the user's message. Title only, no quotes or extra text.\n\nUser: ${userMessage}`;

    const result = await window.electronAPI.chat.send({
      providerType: toolModel.providerType,
      model: toolModel.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that generates concise, descriptive titles for conversations.',
        },
        { role: 'user', content: prompt },
      ],
    });

    if (result.success && result.text) {
      // Clean up the title: remove quotes, extra whitespace, etc.
      let title = result.text.trim();
      // Remove surrounding quotes if present
      title = title.replace(/^["']|["']$/g, '');
      // Limit to 60 characters
      title = title.slice(0, 60);
      return title || userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
    }

    // Fallback to simple truncation
    return userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
  } catch (error) {
    console.error('Failed to generate thread title:', error);
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

const handleMessageSent = async (content: string, model?: string) => {
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

  showWelcome.value = false;

  // Save user message
  const userMessage = await saveMessage('user', content);

  // Add to local messages
  messages.value.push({
    role: 'user',
    content,
    id: userMessage?.id,
  });

  isStreaming.value = true;
  streamingContent.value = '';
  scrollToBottom();
};

const handleStreamChunk = (chunk: string) => {
  streamingContent.value += chunk;
  scrollToBottom();
};

const handleResponseReceived = async (fullText: string) => {
  if (!currentThread.value) return;

  isStreaming.value = false;

  // Get the last user message ID as parent
  const lastUserMessage = messages.value.filter(m => m.role === 'user').pop();
  const parentId = lastUserMessage?.id || null;

  // Save assistant message
  await saveMessage('assistant', fullText, parentId || undefined);

  // Add to local messages
  messages.value.push({
    role: 'assistant',
    content: fullText,
  });

  // Generate thread title using Tool Model if it's still "New Chat" and this is the first exchange
  if (currentThread.value.title === 'New Chat' && messages.value.length === 2) {
    const userMessage = lastUserMessage?.content || '';
    const generatedTitle = await generateThreadTitle(userMessage, fullText);
    if (generatedTitle) {
      await updateThreadTitle(generatedTitle);
    }
  }

  streamingContent.value = '';
  scrollToBottom();
};

// Listen for model selection from ChatInput
onMounted(async () => {
  // Initialize config store if not already initialized
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  // Load threads on mount
  await refreshThreads();
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

.typing {
  color: var(--accent-color);
  font-weight: normal;
  animation: blink 1s infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}
</style>
