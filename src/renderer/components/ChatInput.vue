<template>
  <div class="chat-input-outer">
    <div class="mx-auto max-w-4xl">
      <div class="relative rounded-[22px] border chat-input-container">
        <input
          ref="inputRef"
          v-model="message"
          type="text"
          :placeholder="t('chat.input.placeholder')"
          class="chat-input-field ui-text-primary w-full border-0 bg-transparent px-4 py-6 placeholder-muted focus:outline-none"
          @keydown.enter="handleEnter"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
        />

        <!-- Bottom toolbar -->
        <div
          class="composer-toolbar flex items-center justify-between border-t border-color px-3 py-2"
        >
          <ChatComposerSelectors
            :selected-workspace-id="props.selectedWorkspaceId ?? null"
            :workspace-locked="props.workspaceLocked"
            v-model:selected-skill-ids="selectedSkillIds"
            v-model:skill-mode="skillMode"
            v-model:selected-tools="selectedTools"
            v-model:selected-mcp-server-ids="selectedMcpServerIds"
            v-model:tool-mode="toolMode"
            :available-providers="availableProviders"
            :selected-provider="selectedProvider"
            :selected-model="selectedModel"
            @update:selected-workspace-id="handleWorkspaceChanged"
            @select-provider-model="handleProviderModelSelect"
          />

          <ChatComposerActions
            :context-usage="props.contextUsage ?? null"
            :is-incognito="props.isIncognito ?? false"
            :is-preparing-send="isPreparingSend"
            :is-loading="isLoading"
            :is-stopping="isStopping"
            :is-recording="isRecording"
            :is-transcribing="isTranscribing"
            :speech-engine-available="speechEngineAvailable"
            :show-waveform="showWaveform"
            :waveform-bars="waveformBars"
            :speech-status-label="speechStatusLabel"
            :speech-status-tone-class="speechStatusToneClass"
            @toggle-incognito="toggleIncognitoMode"
            @toggle-voice-input="toggleVoiceInput"
            @send-message="sendMessage"
            @stop-streaming="stopStreaming"
          />
        </div>
      </div>
      <p v-if="composerFeedback" class="composer-feedback" role="alert" aria-live="assertive">
        {{ composerFeedback }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watchEffect } from 'vue';
import type { Provider } from '../../shared/types/provider';
import type { ContextUsageIndicator } from '../modules/chat/ui_message_references';
import type {
  PreparedMessageSend,
  PrepareMessageSendPayload,
} from '../modules/chat/chat_prepare_send';
import ChatComposerActions from './ChatComposerActions.vue';
import ChatComposerSelectors from './ChatComposerSelectors.vue';
import { useChatComposerDraft } from '../composables/useChatComposerDraft';
import { useChatComposerLifecycle } from '../composables/useChatComposerLifecycle';
import { useChatComposerSend } from '../composables/useChatComposerSend';
import { useChatProviderSelection } from '../composables/useChatProviderSelection';
import { useSpeechInput } from '../composables/useSpeechInput';
import { useThreadToolSelection } from '../composables/useThreadToolSelection';
import { useI18n } from '../i18n';
import { getElectronAPI } from '../services/electron_api';

const electronAPI = getElectronAPI();
const { t } = useI18n();
const emit = defineEmits<{
  (event: 'incognito-changed', value: boolean): void;
  (event: 'model-selected', payload: { model: string; provider: Provider }): void;
  (event: 'workspace-changed', value: string | null): void;
}>();

const props = defineProps<{
  threadId?: string;
  activeModel?: string;
  activeProviderId?: string | null;
  isIncognito?: boolean;
  selectedWorkspaceId?: string | null;
  workspaceLocked?: boolean;
  prepareMessageSend?: (payload: PrepareMessageSendPayload) => Promise<PreparedMessageSend | null>;
  contextUsage?: ContextUsageIndicator | null;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const message = ref('');
const isBusy = ref(false);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');

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

let sendMessageHandler: () => Promise<void> | void = () => undefined;
const { setDraftMessage, handleCompositionStart, handleCompositionEnd, handleEnter } =
  useChatComposerDraft({
    inputRef,
    message,
    sendMessage: () => sendMessageHandler(),
    isRecording,
    isTranscribing,
  });

const {
  composerFeedback,
  isPreparingSend,
  isLoading,
  isStopping,
  dismissComposerFeedback,
  sendMessage,
  stopStreaming,
} = useChatComposerSend({
  electronAPI,
  message,
  isRecording,
  isTranscribing,
  selectedTools,
  selectedMcpServerIds,
  selectedSkillIds,
  isAutoToolMode,
  isAutoSkillMode,
  prepareFailedMessage: t('chat.input.prepareFailed'),
  stopFailedMessage: t('chat.input.stopFailed'),
  prepareMessageSend: props.prepareMessageSend,
  ensureProviderReady,
  resolveSelectedMcpServerIds,
  stopVoiceInput,
});
sendMessageHandler = sendMessage;
watchEffect(() => {
  isBusy.value = isPreparingSend.value || isLoading.value;
});

useChatComposerLifecycle({
  electronAPI,
  threadId: toRef(() => props.threadId),
  activeModel: toRef(() => props.activeModel),
  activeProviderId: toRef(() => props.activeProviderId),
  isBusy,
  loadAvailableProviders,
  syncPreferredModel,
  syncToolSelectionFromThread,
  loadSpeechStatus,
});

const handleProviderModelSelect = (payload: { provider: Provider; model: string }) => {
  dismissComposerFeedback();
  selectProviderModel(payload);
  emit('model-selected', payload);
};

const handleWorkspaceChanged = (workspaceId: string | null) => {
  if (props.workspaceLocked) return;
  emit('workspace-changed', workspaceId);
};

const toggleIncognitoMode = () => {
  if (isBusy.value || isStopping.value) return;
  emit('incognito-changed', !props.isIncognito);
};

defineExpose({
  setDraftMessage,
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

.composer-feedback {
  margin-top: 10px;
  border: 1px solid color-mix(in srgb, var(--danger-color) 34%, var(--border-color));
  border-radius: 12px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--danger-color) 9%, var(--bg-secondary));
  color: var(--danger-color);
  font-size: 12px;
  line-height: 1.45;
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

.placeholder-muted::placeholder {
  color: var(--text-muted);
}

.border-color {
  border-color: var(--border-color);
}
</style>
