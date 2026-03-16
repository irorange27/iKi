<template>
  <div class="chat-input-outer">
    <div class="mx-auto max-w-3xl">
      <div class="relative rounded-xl border chat-input-container">
        <input ref="inputRef" v-model="message" type="text" placeholder="Type a message..."
          class="w-full border-0 bg-transparent px-4 py-6 text-primary placeholder-muted focus:outline-none"
          @keydown.enter="handleEnter"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd" />

        <!-- Bottom toolbar -->
        <div class="flex items-center justify-between border-t border-color px-3 py-2">
          <div class="flex items-center gap-2">
            <!-- file upload -->
            <button class="h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <!-- workspace choose -->
            <button class="relative h-8 w-8 rounded-lg text-accent flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span
                class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white">
                1
              </span>
            </button>
            <!-- tool choose -->
            <div
              class="relative"
              @mouseenter="openToolSelector"
              @mouseleave="scheduleCloseToolSelector"
            >
              <button class="relative h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn"
                :class="{ 'text-accent': isAutoToolMode || selectedTools.length > 0 }"
                @click="showToolSelector = !showToolSelector"
                @mouseenter="openToolSelector"
                @mouseleave="scheduleCloseToolSelector">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span v-if="isAutoToolMode || selectedTools.length > 0"
                  class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white">
                  {{ isAutoToolMode ? 'A' : selectedTools.length }}
                </span>
              </button>

              <!-- Tool Selector Menu -->
              <div v-if="showToolSelector"
                class="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden"
                @mouseenter="openToolSelector"
                @mouseleave="scheduleCloseToolSelector">
                <div class="p-3 border-b border-color bg-tertiary">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-primary">Tools</span>
                  </div>
                  <div class="mt-1 text-xs text-muted leading-snug">
                    Allow iKi to use tools (web, files, shell) for the next response. Choose Auto
                    or select manually.
                  </div>

                  <div class="mt-2 flex items-center gap-2">
                    <button
                      class="tool-mode-btn"
                      :class="{ active: isAutoToolMode }"
                      @click="toggleAutoToolMode"
                    >
                      Auto
                    </button>
                    <div class="flex-1" />
                    <button
                      class="tool-action-btn"
                      :disabled="isAutoToolMode"
                      @click="selectAllTools"
                    >
                      Select all
                    </button>
                    <button
                      class="tool-action-btn"
                      :disabled="isAutoToolMode"
                      @click="clearAllTools"
                    >
                      Clear
                    </button>
                  </div>

                  <div v-if="isAutoToolMode" class="mt-2 text-xs text-accent leading-snug">
                    iKi will automatically pick the most relevant tools based on your message.
                  </div>
                </div>
                <div class="max-h-72 overflow-y-auto p-2">
                  <div v-if="availableTools.length === 0" class="p-4 text-center text-sm text-muted">
                    No tools available.
                  </div>
                  <button v-for="tool in availableTools" :key="tool.name"
                    class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between group"
                    :disabled="isAutoToolMode"
                    :class="{
                      'text-accent bg-hover/50': isToolSelected(tool.name) && !isAutoToolMode,
                      'opacity-60 cursor-not-allowed': isAutoToolMode,
                    }" @click="toggleTool(tool.name)">
                    <div class="flex flex-col">
                      <span class="font-medium">{{ tool.name }}</span>
                      <span class="text-[10px] text-muted truncate max-w-[180px]">{{
                        tool.description
                        }}</span>
                    </div>
                    <div class="flex h-4 w-4 items-center justify-center rounded border border-color"
                      :class="{ 'bg-accent border-accent': isToolSelected(tool.name) && !isAutoToolMode }">
                      <svg v-if="isToolSelected(tool.name) && !isAutoToolMode" class="h-3 w-3 text-white" viewBox="0 0 20 20"
                        fill="currentColor">
                        <path fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd" />
                      </svg>
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <div class="relative">
              <button class="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-secondary icon-btn"
                @click="showModelSelector = !showModelSelector">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <span>{{ selectedModel || 'Select Model' }}</span>
                <svg class="h-3 w-3 transition-transform" :class="{ 'rotate-180': showModelSelector }" fill="none"
                  stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <!-- Model/Provider Selector Menu -->
              <div v-if="showModelSelector"
                class="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden">
                <div class="p-2 border-b border-color bg-tertiary">
                  <span class="text-xs font-semibold text-muted uppercase tracking-wider">Select AI Model</span>
                </div>
                <div class="max-h-64 overflow-y-auto p-1">
                  <div v-if="availableProviders.length === 0" class="p-4 text-center text-sm text-muted">
                    No providers configured.
                  </div>
                  <div v-for="provider in availableProviders" :key="provider.id" class="mb-1">
                    <div class="px-3 py-1 text-[10px] font-bold text-accent uppercase">
                      {{ provider.name }}
                    </div>
                    <button v-for="model in JSON.parse(provider.models || '[]')" :key="model"
                      class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between"
                      :class="{
                        'text-accent bg-hover/50':
                          selectedModel === model && selectedProvider.id === provider.id,
                      }" @click="selectProviderAndModel(provider, model)">
                      <span>{{ model }}</span>
                      <svg v-if="selectedModel === model && selectedProvider.id === provider.id"
                        class="h-4 w-4 text-accent" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button class="h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button class="h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
            <button class="h-8 w-8 rounded-lg flex items-center justify-center icon-btn" :class="[
              isLoading ? 'text-danger stop-btn' : 'text-accent',
              isStopping ? 'is-stopping' : '',
            ]" :aria-label="isLoading ? 'Stop generation' : 'Send message'" @click="isLoading ? stopStreaming() : sendMessage()"
              :disabled="isStopping">
              <svg v-if="isLoading" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed, onUnmounted } from 'vue';
import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat?: Chat<any>;
  threadId?: string;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const message = ref('');
const isLoading = ref(false);
const isStopping = ref(false);
const streamDebugRequestId = ref('');
const selectedProvider = ref<any>(null);
const selectedModel = ref('');
const availableProviders = ref<any[]>([]);
const availableModels = ref<string[]>([]);
const isProviderConfigured = ref(false);
const isComposing = ref(false);
const justEndedComposition = ref(false);
const showModelSelector = ref(false);
const showToolSelector = ref(false);
const availableTools = ref<any[]>([]);
const selectedTools = ref<string[]>([]);
const toolMode = ref<'manual' | 'auto'>('manual');
const isAutoToolMode = computed(() => toolMode.value === 'auto');
const toolSelectorCloseTimer = ref<number | null>(null);

const toUiMessages = (messages: any[]): UIMessage[] =>
  messages
    .filter(
      (message: any) =>
        message &&
        typeof message === 'object' &&
        (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    )
    .map((message: any) => {
      const parts = Array.isArray(message.parts)
        ? message.parts.filter((part: any) => part && typeof part === 'object' && typeof part.type === 'string')
        : [
          {
            type: 'text',
            text: typeof message.content === 'string' ? message.content : '',
          },
        ];

      return {
        id:
          typeof message.id === 'string' && message.id.length > 0
            ? message.id
            : `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: message.role,
        parts,
      } as UIMessage;
    });

const loadAvailableProviders = async () => {
  try {
    const providers = await window.electronAPI.providers.list();
    availableProviders.value = providers.filter((p: any) => p.enabled);

    if (availableProviders.value.length > 0) {
      // Set default provider if none selected
      if (!selectedProvider.value) {
        selectedProvider.value = availableProviders.value[0];
        const models = JSON.parse(selectedProvider.value.models || '[]');
        availableModels.value = models;
        selectedModel.value = models[0] || '';
      }
      isProviderConfigured.value = true;
    } else {
      isProviderConfigured.value = false;
    }
  } catch (e) {
    console.error('Failed to load providers:', e);
  }
};

const selectProviderAndModel = (provider: any, model: string) => {
  selectedProvider.value = provider;
  availableModels.value = JSON.parse(provider.models || '[]');
  selectedModel.value = model;
  showModelSelector.value = false;
  emit('model-selected', { provider, model });
};

const loadAvailableTools = async () => {
  try {
    const tools = await window.electronAPI.tools.list();
    availableTools.value = tools;
    // Default: enable all tools so the agent can decide whether to call them.
    // Only apply if the user hasn't made a selection yet.
    if (selectedTools.value.length === 0 && Array.isArray(tools) && tools.length > 0) {
      selectedTools.value = tools
        .map((tool: any) => (tool && typeof tool.name === 'string' ? tool.name : ''))
        .filter((name: string) => typeof name === 'string' && name.trim().length > 0);
    }
  } catch (e) {
    console.error('Failed to load tools:', e);
  }
};

const toggleTool = (toolName: string) => {
  if (isAutoToolMode.value) return;
  const index = selectedTools.value.indexOf(toolName);
  if (index === -1) {
    selectedTools.value.push(toolName);
  } else {
    selectedTools.value.splice(index, 1);
  }
};

const isToolSelected = (toolName: string) => {
  return selectedTools.value.includes(toolName);
};

const selectAllTools = () => {
  if (isAutoToolMode.value) return;
  selectedTools.value = availableTools.value
    .map((t: any) => (t && typeof t.name === 'string' ? t.name : ''))
    .filter((name: string) => typeof name === 'string' && name.trim().length > 0);
};

const clearAllTools = () => {
  if (isAutoToolMode.value) return;
  selectedTools.value = [];
};

const toggleAutoToolMode = () => {
  toolMode.value = isAutoToolMode.value ? 'manual' : 'auto';
};

const openToolSelector = () => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
    toolSelectorCloseTimer.value = null;
  }
  showToolSelector.value = true;
};

const scheduleCloseToolSelector = () => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
  }
  toolSelectorCloseTimer.value = window.setTimeout(() => {
    showToolSelector.value = false;
    toolSelectorCloseTimer.value = null;
  }, 180);
};

watch(selectedProvider, () => {
  checkProviderStatus();
});

// Emit events to parent
const emit = defineEmits([
  'message-sent',
  'model-selected',
]);

const setDraftMessage = async (
  nextValue: string,
  options?: { focus?: boolean; select?: boolean }
) => {
  message.value = nextValue;
  await nextTick();
  if (options?.focus) {
    inputRef.value?.focus();
  }
  if (options?.select) {
    inputRef.value?.select();
  }
};

defineExpose({
  setDraftMessage,
});

// Check if current provider is configured
const checkProviderStatus = async () => {
  if (!selectedProvider.value) {
    isProviderConfigured.value = false;
    return;
  }
  try {
    isProviderConfigured.value = await window.electronAPI.chat.isProviderConfigured(
      selectedProvider.value.type
    );
  } catch (e) {
    console.error('Failed to check provider status:', e);
    isProviderConfigured.value = false;
  }
};

const stopStreaming = async () => {
  if (!isLoading.value || isStopping.value) return;

  isStopping.value = true;
  console.log(
    `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value || 'unknown'}] stopStreaming requested`
  );

  try {
    const result = await window.electronAPI.chat.stopStream();
    if (!result?.success) {
      console.warn('Stop stream request failed:', result?.error || 'Unknown error');
      isLoading.value = false;
      isStopping.value = false;
    }
  } catch (error) {
    console.error('Failed to stop stream:', error);
    isLoading.value = false;
    isStopping.value = false;
  }
};

const handleCompositionStart = () => {
  isComposing.value = true;
};

const handleCompositionEnd = () => {
  isComposing.value = false;
  justEndedComposition.value = true;
  window.setTimeout(() => {
    justEndedComposition.value = false;
  }, 0);
};

const handleEnter = (event: KeyboardEvent) => {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.which === 229 ||
    isComposing.value ||
    justEndedComposition.value
  ) {
    return;
  }

  sendMessage();
};

const sendMessage = async () => {
  if (!message.value.trim() || isLoading.value) return;

  if (!selectedProvider.value) {
    alert('Please configure a provider in Settings first.');
    return;
  }

  // Re-check provider status each time
  const configured = await window.electronAPI.chat.isProviderConfigured(
    selectedProvider.value.type
  );
  if (!configured) {
    alert(`Please configure the ${selectedProvider.value.name} API key in Settings.`);
    return;
  }

  const userMessage = message.value.trim();
  message.value = '';
  isLoading.value = true;
  isStopping.value = false;
  streamDebugRequestId.value = `req-${Date.now()}`;
  console.log(
    `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value}] sendMessage provider=${selectedProvider.value.type} model=${selectedModel.value} toolMode=${isAutoToolMode.value ? 'auto' : 'manual'} toolCount=${isAutoToolMode.value ? 0 : selectedTools.value.length} promptLen=${userMessage.length}`
  );

  // Emit message-sent and wait for ChatView to finish thread/message setup.
  await new Promise<void>(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    emit('message-sent', userMessage, selectedModel.value, selectedTools.value, done);
    window.setTimeout(done, 1500);
  });

  try {
    // Convert chat.messages to AI SDK model messages for IPC
    // Note: The user message may not be in chat.messages yet (it's added in ChatView.handleMessageSent)
    // So we need to include it manually if it's not there
    const rawMessages = props.chat?.messages || [];

    // Check if the last message is the user message we just sent
    const lastMessage = rawMessages[rawMessages.length - 1];
    const userMessageInChat =
      lastMessage &&
      lastMessage.role === 'user' &&
      Array.isArray(lastMessage.parts) &&
      lastMessage.parts.find((p: any) => p && p.type === 'text' && p.text === userMessage);

    // If user message is not in chat.messages yet, include it manually
    const messagesToConvert = userMessageInChat
      ? rawMessages
      : [
        ...rawMessages,
        {
          role: 'user',
          parts: [{ type: 'text', text: userMessage }],
        },
      ];

    const uiMessages = toUiMessages(messagesToConvert);

    if (uiMessages.length === 0) {
      console.warn('No valid messages to send');
      isLoading.value = false;
      return;
    }

    const transportMessages = JSON.parse(JSON.stringify(uiMessages));

    // Start streaming via IPC
    const streamResult = await window.electronAPI.chat.stream({
      providerType: selectedProvider.value.type,
      model: selectedModel.value,
      messages: transportMessages,
      tools:
        isAutoToolMode.value
          ? undefined
          : selectedTools.value.length > 0
          ? JSON.parse(JSON.stringify(selectedTools.value))
          : undefined,
      threadId: props.threadId,
    });

    if (streamResult?.success === false) {
      throw new Error(streamResult?.error || 'Stream failed');
    }

    if (streamResult?.awaitingApproval) {
      console.log(
        `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value}] awaitingApproval=true pause-for-user-approval`
      );
      isLoading.value = false;
      isStopping.value = false;
    } else {
      isLoading.value = false;
      isStopping.value = false;
    }
    console.log(
      `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value}] chat.stream resolved`
    );
  } catch (error: any) {
    console.error('Failed to send message:', error);
    isLoading.value = false;
    isStopping.value = false;
    // Remove the user message if failed (it was already added to chat.messages in ChatView)
    // The error handler will clean up the state
  }
};

onMounted(async () => {
  await loadAvailableProviders();
  await loadAvailableTools();
});

onUnmounted(() => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
    toolSelectorCloseTimer.value = null;
  }
});
</script>
<style scoped>
.chat-input-outer {
  padding: var(--chat-composer-padding, 10px);
}

.chat-input-container {
  border-color: var(--border-color);
  background-color: var(--bg-tertiary);
}

.text-primary {
  color: var(--text-primary);
}

.placeholder-muted::placeholder {
  color: var(--text-muted);
}

.border-color {
  border-color: var(--border-color);
}

button {
  transition: all 0.2s;
}

.text-secondary {
  color: var(--text-secondary);
}

.text-accent {
  color: var(--accent-color);
}

.text-danger {
  color: var(--danger-color);
}

.stop-btn {
  background-color: rgba(239, 68, 68, 0.18);
}

.stop-btn:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.28);
  color: #ffffff;
}

.is-stopping {
  opacity: 0.75;
}

.icon-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

/* Specific overrides for badges */
.bg-\[\#4a9eff\] {
  background-color: var(--accent-color);
}

.bg-secondary {
  background-color: var(--bg-secondary);
}

.bg-tertiary {
  background-color: var(--bg-tertiary);
}

.bg-hover\/50 {
  background-color: rgba(var(--accent-rgb, 74, 158, 255), 0.1);
}

.rotate-180 {
  transform: rotate(180deg);
}

.max-h-64 {
  max-height: 16rem;
}

.shadow-xl {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.2),
    0 10px 10px -5px rgba(0, 0, 0, 0.1);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tool-mode-btn {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
}

.tool-mode-btn.active {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.18);
  border-color: rgba(var(--accent-rgb, 74, 158, 255), 0.35);
  color: var(--text-primary);
}

.tool-action-btn {
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
}

.tool-action-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}
</style>
