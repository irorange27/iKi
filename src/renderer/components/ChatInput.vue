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
            <WorkspaceSelector
              :selected-workspace-id="props.selectedWorkspaceId ?? null"
              @update:selected-workspace-id="handleWorkspaceChanged"
            />
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
              class="composer-icon-btn composer-mode-btn h-8 w-8 rounded-lg flex items-center justify-center"
              :class="props.isIncognito ? 'is-incognito ui-text-accent' : 'ui-text-secondary'"
              :aria-label="incognitoAriaLabel"
              :aria-pressed="props.isIncognito"
              :title="incognitoTooltip"
              :disabled="isPreparingSend || isLoading || isStopping"
              @click="toggleIncognitoMode"
            >
              <svg
                v-if="props.isIncognito"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 3l18 18"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10.58 10.58A3 3 0 0012 15a3 3 0 002.42-1.22"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9.88 5.09A10.94 10.94 0 0112 5c4.48 0 8.27 2.94 9.54 7a11.92 11.92 0 01-4.13 5.36M6.1 6.1A11.96 11.96 0 002.46 12a11.95 11.95 0 005.17 6.37A10.88 10.88 0 0012 19c1.78 0 3.46-.39 4.96-1.09"
                />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              :disabled="
                !speechEngineAvailable ||
                isPreparingSend ||
                isLoading ||
                isStopping ||
                isTranscribing
              "
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
              :disabled="isPreparingSend || isStopping || isRecording || isTranscribing"
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
import type { UIMessage } from 'ai';
import type { Provider } from '../../shared/types/provider';
import { getErrorMessage } from '../../shared/utils/errors';
import { createLogger } from '../logger';
import { useChatProviderSelection } from '../composables/useChatProviderSelection';
import { useSpeechInput } from '../composables/useSpeechInput';
import { useThreadToolSelection } from '../composables/useThreadToolSelection';
import ChatModelSelector from './ChatModelSelector.vue';
import ToolSelector from './ToolSelector.vue';
import SkillSelector from './SkillSelector.vue';
import WorkspaceSelector from './WorkspaceSelector.vue';

const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const chatInputLogger = createLogger({ module: 'chat_input' });
const emit = defineEmits<{
  (event: 'incognito-changed', value: boolean): void;
  (event: 'model-selected', payload: { model: string; provider: Provider }): void;
  (event: 'workspace-changed', value: string | null): void;
}>();

const props = defineProps<{
  threadId?: string;
  activeModel?: string;
  isIncognito?: boolean;
  selectedWorkspaceId?: string | null;
  prepareMessageSend?: (payload: {
    content: string;
    model?: string;
    tools?: string[];
    mcpServerIds?: string[];
  }) => Promise<
    | {
        threadId: string;
        messagesSnapshot: UIMessage[];
      }
    | null
  >;
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
const isPreparingSend = ref(false);
const isLoading = ref(false);
const isStopping = ref(false);
const isComposing = ref(false);
const justEndedComposition = ref(false);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');
const incognitoAriaLabel = computed(() =>
  props.isIncognito ? 'Disable incognito mode' : 'Enable incognito mode'
);
const incognitoTooltip = computed(() =>
  props.isIncognito
    ? 'Incognito is on. Memory is disabled for this chat.'
    : 'Incognito is off. Memory is enabled for this chat.'
);
const isBusy = computed(() => isPreparingSend.value || isLoading.value);

const {
  selectedProvider,
  selectedModel,
  availableProviders,
  loadAvailableProviders,
  selectProviderModel,
  syncPreferredModel,
  ensureProviderReady,
} = useChatProviderSelection({
  electronAPI,
});

const {
  selectedTools,
  selectedMcpServerIds,
  toolMode,
  isAutoToolMode,
  syncToolSelectionFromThread,
  resolveSelectedMcpServerIds,
} = useThreadToolSelection({
  electronAPI,
  isLoading: isBusy,
});

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

const handleProviderModelSelect = (payload: { provider: Provider; model: string }) => {
  selectProviderModel(payload);
  emit('model-selected', payload);
};

const handleWorkspaceChanged = (workspaceId: string | null) => {
  emit('workspace-changed', workspaceId);
};

const toggleIncognitoMode = () => {
  if (isBusy.value || isStopping.value) return;
  emit('incognito-changed', !props.isIncognito);
};

watch(
  () => [props.threadId, isBusy.value] as const,
  async ([threadId, busy], [previousThreadId, previousBusy]) => {
    if (busy) return;
    if (threadId === previousThreadId && previousBusy === busy) return;
    await syncToolSelectionFromThread(threadId);
  }
);

watch(
  () => props.activeModel,
  (activeModel, previousActiveModel) => {
    if (activeModel === previousActiveModel) return;
    syncPreferredModel(activeModel);
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
      chatInputLogger.event({
        level: 'warn',
        event: 'chat.stream.stop',
        outcome: 'failed',
        message: typeof result?.error === 'string' ? result.error : 'Unknown error',
      });
      isLoading.value = false;
      isStopping.value = false;
    }
  } catch (error) {
    chatInputLogger.event({
      level: 'error',
      event: 'chat.stream.stop',
      outcome: 'failed',
      error,
    });
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
  if (!message.value.trim() || isPreparingSend.value || isLoading.value) return;

  const providerReady = await ensureProviderReady();
  if (providerReady.ok === false) {
    alert(providerReady.message);
    return;
  }

  const userMessage = message.value.trim();
  const resolvedMcpServerIds = await resolveSelectedMcpServerIds();
  selectedMcpServerIds.value = resolvedMcpServerIds;
  isPreparingSend.value = true;

  let preparedMessageSend: { threadId: string; messagesSnapshot: UIMessage[] } | null = null;
  try {
    if (!props.prepareMessageSend) {
      chatInputLogger.event({
        level: 'error',
        event: 'chat.send.prepare',
        outcome: 'failed',
        message: 'Missing prepareMessageSend handler.',
      });
    } else {
      preparedMessageSend = await props.prepareMessageSend({
        content: userMessage,
        model: providerReady.model,
        tools: selectedTools.value,
        mcpServerIds: resolvedMcpServerIds,
      });
    }
  } catch (error) {
    chatInputLogger.event({
      level: 'error',
      event: 'chat.send.prepare',
      outcome: 'failed',
      error,
    });
  } finally {
    isPreparingSend.value = false;
  }

  if (!preparedMessageSend) {
    alert('Failed to prepare the message. Please try again.');
    return;
  }

  message.value = '';
  isLoading.value = true;
  isStopping.value = false;

  try {
    const transportMessages = JSON.parse(JSON.stringify(preparedMessageSend.messagesSnapshot));

    if (!Array.isArray(transportMessages) || transportMessages.length === 0) {
      chatInputLogger.event({
        level: 'warn',
        event: 'chat.send',
        outcome: 'skipped',
        message: 'No valid messages to send.',
      });
      isLoading.value = false;
      return;
    }

    // Start streaming via IPC
    const streamResult = await electronAPI.chat.stream({
      providerType: providerReady.provider.type,
      model: providerReady.model,
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
      threadId: preparedMessageSend.threadId,
    });

    if (streamResult?.success === false) {
      throw new Error(streamResult?.error || 'Stream failed');
    }

    isLoading.value = false;
    isStopping.value = false;
  } catch (error: unknown) {
    chatInputLogger.event({
      level: 'error',
      event: 'chat.send',
      outcome: 'failed',
      error,
    });
    isLoading.value = false;
    isStopping.value = false;
    chatInputLogger.event({
      level: 'warn',
      event: 'chat.send',
      outcome: 'degraded',
      message: getErrorMessage(error),
    });
    // Remove the user message if failed (it was already added to chat.messages in ChatView)
    // The error handler will clean up the state
  }
};

onMounted(async () => {
  await loadAvailableProviders(props.activeModel);
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

.composer-icon-btn {
  border: 1px solid var(--chat-composer-control-border-color);
  background: var(--chat-composer-control-background);
  box-shadow: var(--surface-inset-highlight);
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

.composer-mode-btn.is-incognito {
  border-color: rgba(var(--accent-rgb), 0.34);
  background: rgba(var(--accent-rgb), 0.12);
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
