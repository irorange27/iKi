<template>
  <div class="chat-input-outer">
    <div class="mx-auto max-w-4xl">
      <ChatTodoPlan v-if="props.todoPlan" class="chat-input-plan" :plan="props.todoPlan" />
      <ChatComposerShell
        :set-input-ref="setInputRef"
        v-model="message"
        :placeholder="t('chat.input.placeholder')"
        :feedback="composerFeedback"
        @keydown-enter="handleEnter"
        @composition-start="handleCompositionStart"
        @composition-end="handleCompositionEnd"
      >
        <template #toolbar-left>
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
        </template>

        <template #toolbar-right>
          <ChatComposerActions
            :context-usage="composerContextUsage"
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
        </template>
      </ChatComposerShell>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watchEffect } from 'vue';
import type { Provider } from '../../shared/types/provider';
import type { TaskPlan } from '../../shared/types/task_plan';
import {
  buildTokenUsageIndicator,
  type TokenUsageSummary,
} from '../modules/chat/ui_message_references';
import type {
  PreparedMessageSend,
  PrepareMessageSendPayload,
} from '../modules/chat/chat_prepare_send';
import ChatTodoPlan from './chat/ChatTodoPlan.vue';
import ChatComposerActions from './ChatComposerActions.vue';
import ChatComposerSelectors from './ChatComposerSelectors.vue';
import ChatComposerShell from './ChatComposerShell.vue';
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
  latestTokenUsage?: TokenUsageSummary | null;
  todoPlan?: TaskPlan | null;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const setInputRef = (element: HTMLInputElement | null) => {
  inputRef.value = element;
};
const message = ref('');
const isBusy = ref(false);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');

const {
  selectedProvider,
  selectedModel,
  selectedModelCapability,
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

const composerContextUsage = computed(() => {
  const latestUsage = props.latestTokenUsage ?? null;
  const modelCapability = selectedModelCapability.value;

  return buildTokenUsageIndicator({
    inputTokens: latestUsage?.inputTokens ?? null,
    outputTokens: latestUsage?.outputTokens ?? null,
    totalTokens: latestUsage?.totalTokens ?? null,
    cacheReadTokens: latestUsage?.cacheReadTokens ?? null,
    cacheWriteTokens: latestUsage?.cacheWriteTokens ?? null,
    reasoningTokens: latestUsage?.reasoningTokens ?? null,
    estimatedCostUsd: latestUsage?.estimatedCostUsd ?? null,
    maxInputTokens:
      modelCapability?.maxInputTokens ??
      modelCapability?.contextWindow ??
      latestUsage?.maxInputTokens ??
      null,
    maxOutputTokens: modelCapability?.maxOutputTokens ?? latestUsage?.maxOutputTokens ?? null,
    model: selectedModel.value || latestUsage?.model || '',
    providerType: selectedProvider.value?.type || latestUsage?.providerType || '',
    providerId: selectedProvider.value?.id || latestUsage?.providerId || '',
  });
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
  replaceDraftMessageAndSend: async (
    nextValue: string,
    options?: { focus?: boolean; select?: boolean }
  ) => {
    await setDraftMessage(nextValue, options);
    await sendMessage();
  },
});
</script>
<style scoped>
.chat-input-outer {
  padding: var(--chat-composer-padding, 10px);
}

.chat-input-plan {
  margin-bottom: 10px;
}
</style>
