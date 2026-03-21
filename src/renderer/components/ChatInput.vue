<template>
  <div class="chat-input-outer">
    <div class="mx-auto max-w-4xl">
      <div class="relative rounded-[22px] border chat-input-container">
        <input
          ref="inputRef"
          v-model="message"
          type="text"
          placeholder="Type a message..."
          class="chat-input-field ui-text-primary w-full border-0 bg-transparent px-4 py-6 placeholder-muted focus:outline-none"
          @keydown.enter="handleEnter"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
        />

        <!-- Bottom toolbar -->
        <div
          class="composer-toolbar flex items-center justify-between border-t border-color px-3 py-2"
        >
          <div class="composer-toolbar-left flex items-center gap-2">
            <!-- file upload -->
            <button
              class="composer-attach-btn ui-text-secondary flex h-8 w-8 items-center justify-center"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            </button>
            <!-- workspace choose -->
            <button
              class="composer-icon-btn composer-selection-btn ui-text-accent relative flex h-10 w-10 items-center justify-center rounded-[14px]"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span class="selector-badge">1</span>
            </button>
            <!-- skill choose -->
            <SkillSelector v-model:skill-ids="selectedSkillIds" v-model:mode="skillMode" />
            <!-- tool choose -->
            <ToolSelector
              v-model:tools="selectedTools"
              v-model:mcp-server-ids="selectedMcpServerIds"
              v-model:mode="toolMode"
            />
            <ChatModelSelector
              :available-providers="availableProviders"
              :selected-provider="selectedProvider"
              :selected-model="selectedModel"
              @select="handleProviderModelSelect"
            />
          </div>

          <div class="composer-toolbar-right flex items-center gap-2">
            <div
              v-if="contextUsage"
              class="composer-context-indicator"
              :title="contextUsage.tooltip"
              aria-label="Context usage"
            >
              <svg
                class="composer-context-icon"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.9"
                  d="M5 14a7 7 0 1114 0"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.9"
                  d="M12 14l3-3"
                />
              </svg>
              <span class="composer-context-value">
                {{ contextUsage.percentLabel || contextUsage.tokenLabel }}
              </span>
            </div>
            <button
              class="composer-icon-btn ui-text-secondary h-8 w-8 rounded-lg flex items-center justify-center"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </button>

            <div v-if="showWaveform" class="speech-waveform" aria-hidden="true">
              <span
                v-for="(bar, idx) in waveformBars"
                :key="idx"
                class="speech-waveform-bar"
                :style="{ height: `${Math.max(18, Math.round(bar * 100))}%` }"
              />
            </div>

            <button
              class="composer-icon-btn speech-btn h-8 w-8 rounded-lg flex items-center justify-center"
              :class="[
                isRecording
                  ? 'ui-text-danger'
                  : isTranscribing
                    ? 'ui-text-accent'
                    : speechEngineAvailable
                      ? 'ui-text-secondary'
                      : 'ui-text-muted speech-btn-unavailable',
                isTranscribing ? 'is-transcribing' : '',
              ]"
              :disabled="!speechEngineAvailable || isLoading || isStopping || isTranscribing"
              :aria-label="isRecording ? 'Stop voice input' : 'Start voice input'"
              @click="toggleVoiceInput"
            >
              <svg v-if="isRecording" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg
                v-else-if="isTranscribing"
                class="h-4 w-4 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 12a8 8 0 018-8m0 16a8 8 0 008-8"
                />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </button>
            <span
              v-if="speechStatusLabel"
              class="text-[10px] whitespace-nowrap"
              :class="speechStatusToneClass"
            >
              {{ speechStatusLabel }}
            </span>
            <button
              class="composer-icon-btn send-btn h-8 w-8 rounded-lg flex items-center justify-center"
              :class="[
                isLoading ? 'ui-text-danger stop-btn' : 'ui-text-accent',
                isStopping ? 'is-stopping' : '',
              ]"
              :aria-label="isLoading ? 'Stop generation' : 'Send message'"
              @click="isLoading ? stopStreaming() : sendMessage()"
              :disabled="isStopping || isRecording || isTranscribing"
            >
              <svg
                v-if="isLoading"
                class="h-4 w-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from 'vue';
import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';
import type { Provider } from '../../shared/types/provider';
import { getErrorMessage } from '../../shared/utils/errors';
import { parseModelList } from '../../shared/utils/provider_models';
import { toUiMessages } from '../modules/chat/ui_message_convert';
import { getProviderDisplayName } from '../modules/providers/provider_display';
import { useSpeechInput } from '../composables/useSpeechInput';
import ChatModelSelector from './ChatModelSelector.vue';
import ToolSelector from './ToolSelector.vue';
import SkillSelector from './SkillSelector.vue';

const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const emit = defineEmits<{
  (
    event: 'message-sent',
    content: string,
    model?: string,
    tools?: string[],
    mcpServerIds?: string[],
    onReady?: () => void
  ): void;
  (event: 'model-selected', payload: { model: string; provider: Provider }): void;
}>();

const props = defineProps<{
  chat?: Chat<UIMessage>;
  threadId?: string;
  contextUsage?: {
    usedTokens: number;
    budgetTokens: number | null;
    percent: number | null;
    percentLabel: string;
    tokenLabel: string;
    tooltip: string;
  } | null;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const message = ref('');
const isLoading = ref(false);
const isStopping = ref(false);
const selectedProvider = ref<Provider | null>(null);
const selectedModel = ref('');
const availableProviders = ref<Provider[]>([]);
const isComposing = ref(false);
const justEndedComposition = ref(false);
const selectedTools = ref<string[]>([]);
const selectedMcpServerIds = ref<string[]>([]);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const toolMode = ref<'manual' | 'auto'>('auto');
const isAutoToolMode = computed(() => toolMode.value === 'auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');

type ThreadToolSelectionState = {
  mode?: 'manual' | 'auto';
  mcpServerIds: string[];
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

const isTextMessagePart = (part: unknown, expectedText: string): boolean =>
  !!part &&
  typeof part === 'object' &&
  'type' in part &&
  'text' in part &&
  (part as { type?: unknown }).type === 'text' &&
  (part as { text?: unknown }).text === expectedText;

const parseThreadToolSelectionState = (metadataRaw: unknown): ThreadToolSelectionState => {
  if (!metadataRaw || typeof metadataRaw !== 'object') {
    return { mcpServerIds: [] };
  }

  const metadata = metadataRaw as { toolSelection?: unknown };
  const toolSelection =
    metadata.toolSelection && typeof metadata.toolSelection === 'object'
      ? (metadata.toolSelection as { mode?: unknown; mcpServerIds?: unknown })
      : null;

  return {
    mode:
      toolSelection?.mode === 'auto' || toolSelection?.mode === 'manual'
        ? toolSelection.mode
        : undefined,
    mcpServerIds: parseStringArray(toolSelection?.mcpServerIds),
  };
};

const deriveMcpServerIdsFromToolNames = async (toolNames: string[]): Promise<string[]> => {
  const normalizedToolNames = new Set(parseStringArray(toolNames));
  if (normalizedToolNames.size === 0) return [];

  try {
    const tools = await electronAPI.tools.list();
    if (!Array.isArray(tools)) return [];

    const resolvedServerIds = new Set<string>();
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = typeof tool.name === 'string' ? tool.name.trim() : '';
      const source =
        tool.source && typeof tool.source === 'object'
          ? (tool.source as { kind?: unknown; id?: unknown })
          : null;
      if (!name || !normalizedToolNames.has(name)) continue;
      if (source?.kind !== 'mcp' || typeof source.id !== 'string' || !source.id.trim()) continue;
      resolvedServerIds.add(source.id.trim());
    }

    return Array.from(resolvedServerIds);
  } catch (error) {
    console.error('Failed to derive MCP server ids from tools:', error);
    return [];
  }
};

const resolveSelectedMcpServerIds = async (): Promise<string[]> => {
  if (selectedMcpServerIds.value.length > 0) {
    return parseStringArray(selectedMcpServerIds.value);
  }
  return await deriveMcpServerIdsFromToolNames(selectedTools.value);
};

const syncToolSelectionFromThread = async (threadId?: string) => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId || isLoading.value) return;

  try {
    const thread = await electronAPI.chat.threads.get(normalizedThreadId);
    if (!thread) return;

    const persistedTools = parseStringArray(
      typeof thread.tools === 'string' ? JSON.parse(thread.tools) : []
    );

    let parsedMetadata: unknown = {};
    if (typeof thread.metadata === 'string' && thread.metadata.trim()) {
      try {
        parsedMetadata = JSON.parse(thread.metadata);
      } catch {
        parsedMetadata = {};
      }
    }

    const selectionState = parseThreadToolSelectionState(parsedMetadata);
    const resolvedMcpServerIds =
      selectionState.mcpServerIds.length > 0
        ? selectionState.mcpServerIds
        : await deriveMcpServerIdsFromToolNames(persistedTools);
    const hasPersistedSelection =
      persistedTools.length > 0 ||
      resolvedMcpServerIds.length > 0 ||
      selectionState.mode === 'auto' ||
      selectionState.mode === 'manual';

    if (!hasPersistedSelection) return;

    selectedTools.value = persistedTools;
    selectedMcpServerIds.value = resolvedMcpServerIds;
    if (selectionState.mode) {
      toolMode.value = selectionState.mode;
    }
  } catch (error) {
    console.error('Failed to sync tool selection from thread:', error);
  }
};

const {
  isRecording,
  isTranscribing,
  speechStatusLabel,
  speechStatusToneClass,
  speechEngineAvailable,
  showWaveform,
  waveformBars,
  loadSpeechStatus,
  toggleVoiceInput,
  stopVoiceInput,
} = useSpeechInput({ inputRef, message });

const loadAvailableProviders = async () => {
  try {
    const providers = await electronAPI.providers.list();
    const normalizedProviders = Array.isArray(providers)
      ? (providers.filter((provider: Provider) => provider?.enabled) as Provider[])
      : [];

    availableProviders.value = normalizedProviders;

    if (normalizedProviders.length === 0) {
      selectedProvider.value = null;
      selectedModel.value = '';
      return;
    }

    const previousProviderId = selectedProvider.value?.id;
    const previousProvider = normalizedProviders.find(
      provider => provider.id === previousProviderId
    );
    const previousProviderModels = previousProvider ? parseModelList(previousProvider.models) : [];
    const nextSelectedProvider =
      (previousProvider && previousProviderModels.length > 0 ? previousProvider : null) ||
      normalizedProviders.find(provider => parseModelList(provider.models).length > 0) ||
      previousProvider ||
      normalizedProviders[0];
    const availableProviderModels = parseModelList(nextSelectedProvider.models);

    selectedProvider.value = nextSelectedProvider;
    if (!availableProviderModels.includes(selectedModel.value)) {
      selectedModel.value = availableProviderModels[0] || '';
    }
  } catch (e) {
    console.error('Failed to load providers:', e);
  }
};

const handleProviderModelSelect = (payload: { provider: Provider; model: string }) => {
  const { provider, model } = payload;
  selectedProvider.value = provider;
  selectedModel.value = model;
  emit('model-selected', { provider, model });
};

watch(
  () => [props.threadId, isLoading.value] as const,
  async ([threadId, loading], [previousThreadId, previousLoading]) => {
    if (loading) return;
    if (threadId === previousThreadId && previousLoading === loading) return;
    await syncToolSelectionFromThread(threadId);
  }
);

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

const stopStreaming = async () => {
  if (!isLoading.value || isStopping.value) return;

  isStopping.value = true;

  try {
    const result = await electronAPI.chat.stopStream();
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

  if (isRecording.value || isTranscribing.value) {
    return;
  }

  sendMessage();
};

const sendMessage = async () => {
  if (isRecording.value || isTranscribing.value) {
    stopVoiceInput();
    return;
  }
  if (!message.value.trim() || isLoading.value) return;

  if (!selectedProvider.value) {
    alert('Please configure a provider in Settings first.');
    return;
  }

  // Re-check provider status each time
  const configured = await electronAPI.chat.isProviderConfigured(selectedProvider.value.type);
  const selectedProviderName = getProviderDisplayName(selectedProvider.value);
  if (!configured) {
    alert(`Please configure the ${selectedProviderName} API key in Settings.`);
    return;
  }

  if (!selectedModel.value.trim()) {
    alert(`Please add at least one model for ${selectedProviderName} in Settings.`);
    return;
  }

  const userMessage = message.value.trim();
  const resolvedMcpServerIds = await resolveSelectedMcpServerIds();
  selectedMcpServerIds.value = resolvedMcpServerIds;
  message.value = '';
  isLoading.value = true;
  isStopping.value = false;

  // Emit message-sent and wait for ChatView to finish thread/message setup.
  await new Promise<void>(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    emit(
      'message-sent',
      userMessage,
      selectedModel.value,
      selectedTools.value,
      resolvedMcpServerIds,
      done
    );
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
      lastMessage.parts.some((part: unknown) => isTextMessagePart(part, userMessage));

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
    const streamResult = await electronAPI.chat.stream({
      providerType: selectedProvider.value.type,
      model: selectedModel.value,
      messages: transportMessages,
      tools: isAutoToolMode.value
        ? undefined
        : selectedTools.value.length > 0
          ? JSON.parse(JSON.stringify(selectedTools.value))
          : [],
      mcpServerIds: JSON.parse(JSON.stringify(resolvedMcpServerIds)),
      skillMode: isAutoSkillMode.value ? 'auto' : 'manual',
      skillIds: isAutoSkillMode.value
        ? undefined
        : JSON.parse(JSON.stringify(selectedSkillIds.value)),
      threadId: props.threadId,
    });

    if (streamResult?.success === false) {
      throw new Error(streamResult?.error || 'Stream failed');
    }

    isLoading.value = false;
    isStopping.value = false;
  } catch (error: unknown) {
    console.error('Failed to send message:', error);
    isLoading.value = false;
    isStopping.value = false;
    console.warn('Chat send failed:', getErrorMessage(error));
    // Remove the user message if failed (it was already added to chat.messages in ChatView)
    // The error handler will clean up the state
  }
};

onMounted(async () => {
  await loadAvailableProviders();
  await loadSpeechStatus();
  await syncToolSelectionFromThread(props.threadId);
});
</script>
<style scoped>
.chat-input-outer {
  padding: var(--chat-composer-padding, 10px);
}

.chat-input-container {
  border-color: var(--chat-composer-border-color);
  border-radius: 12px;
  background: var(--chat-composer-background);
  box-shadow: var(--chat-composer-shadow);
  backdrop-filter: var(--chat-composer-backdrop-filter);
}

.chat-input-field {
  padding-top: 28px;
  padding-bottom: 28px;
  font-size: 15px;
}

.composer-toolbar {
  padding: 10px 12px 12px;
  border-top-color: var(--chat-composer-toolbar-border-color);
  background: var(--chat-composer-toolbar-background);
}

.composer-toolbar-left {
  gap: 8px;
  min-width: 0;
}

.composer-toolbar-right {
  gap: 14px;
}

.composer-context-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  user-select: none;
  white-space: nowrap;
}

.composer-context-icon {
  width: 14px;
  height: 14px;
  opacity: 0.85;
}

.composer-context-value {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;
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

.composer-attach-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
}

.composer-attach-btn:hover {
  color: var(--text-primary);
}

.composer-icon-btn {
  border: 1px solid var(--chat-composer-control-border-color);
  background: var(--chat-composer-control-background);
  box-shadow: var(--surface-inset-highlight);
}

.composer-selection-btn {
  box-shadow:
    var(--surface-inset-highlight),
    var(--surface-shadow-md);
}

.send-btn {
  background: var(--chat-composer-send-background);
  box-shadow: none;
}

.stop-btn {
  background-color: var(--chat-composer-stop-background);
}

.stop-btn:hover:not(:disabled) {
  background-color: var(--chat-composer-stop-hover-background);
  border-color: var(--chat-composer-stop-hover-border-color);
  color: var(--chat-composer-action-foreground);
}

.send-btn:hover:not(:disabled) {
  background: var(--chat-composer-send-hover-background);
  border-color: var(--chat-composer-send-hover-border-color);
  box-shadow: var(--chat-composer-send-hover-shadow);
  color: var(--chat-composer-action-foreground);
}

.is-stopping {
  opacity: 0.75;
}

.is-transcribing {
  animation: micPulse 1.2s ease-in-out infinite;
}

.composer-icon-btn:hover {
  background-color: var(--chat-composer-control-hover-background);
  border-color: var(--chat-composer-control-hover-border-color);
  color: var(--text-primary);
}

.composer-icon-btn:disabled {
  opacity: 0.78;
  border-color: var(--chat-composer-control-disabled-border-color);
  background: var(--chat-composer-control-disabled-background);
}

.speech-btn-unavailable {
  color: color-mix(in srgb, var(--text-secondary) 68%, var(--text-muted));
}

.speech-btn-unavailable:disabled {
  opacity: 0.9;
}

.speech-waveform {
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 32px;
  width: 32px;
  padding: 6px 5px;
  border-radius: 10px;
  border: 1px solid rgba(var(--accent-rgb), 0.35);
  background: rgba(var(--accent-rgb), 0.18);
  color: var(--accent-color);
  box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.08);
}

.speech-waveform-bar {
  width: 3px;
  min-height: 6px;
  border-radius: 999px;
  background-color: currentColor;
  transition: height 0.08s ease;
}

@keyframes micPulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

button:disabled {
  cursor: not-allowed;
}
</style>
