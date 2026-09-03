<template>
  <div class="chat-input-outer">
    <ChatSteerBar
      :visible="isLoading && isAutonomousMode"
      :disabled="isStopping"
      @steer="handleSteer"
    />
    <div class="mx-auto max-w-4xl">
      <ChatTodoPlan v-if="props.todoPlan" class="chat-input-plan" :plan="props.todoPlan" />
      <ChatComposerShell
        :set-input-ref="setInputRef"
        v-model="message"
        :placeholder="composerPlaceholder"
        :feedback="composerFeedback"
        @dismiss-feedback="dismissComposerFeedback"
        @keydown="handleComposerKeydown"
        @keydown-enter="handleEnter"
        @composition-start="handleCompositionStart"
        @composition-end="handleCompositionEnd"
        @paste-image="handlePasteImage"
        @drop-images="handleDropImages"
      >
        <template #input-context>
          <div
            v-if="inlineComposerTokens.length > 0"
            class="composer-inline-tokens"
            role="status"
            aria-live="polite"
          >
            <button
              v-for="token in inlineComposerTokens"
              :key="token.id"
              type="button"
              class="composer-inline-token"
              :class="token.toneClass"
              :title="token.title"
              @click="handleInlineTokenClick(token)"
            >
              <span v-if="token.prefix" class="composer-inline-token-prefix" aria-hidden="true">
                {{ token.prefix }}
              </span>
              <span class="composer-inline-token-label">{{ token.label }}</span>
              <span class="composer-inline-token-dismiss" aria-hidden="true">x</span>
            </button>
          </div>
        </template>

        <template #input-overlay>
          <div
            v-if="isSlashCommandMenuVisible"
            class="slash-command-menu ui-scrollbar"
            role="listbox"
            :aria-label="t('chat.input.slashCommandsTitle')"
          >
            <template v-for="(command, index) in slashCommandSuggestions" :key="command.id">
              <div
                v-if="shouldShowSkillSectionLabel(index)"
                class="slash-command-section-label ui-text-secondary"
                aria-hidden="true"
              >
                <span>{{ t('chat.input.slash.skillsSection') }}</span>
              </div>

              <button
                type="button"
                class="slash-command-item"
                :class="index === activeSlashCommandIndex ? 'is-active' : ''"
                role="option"
                :aria-selected="index === activeSlashCommandIndex"
                @mousedown.prevent="applySlashCommandSuggestion(command)"
              >
                <span class="slash-command-shortcut ui-text-accent">/{{ command.shortcut }}</span>
                <span class="slash-command-name ui-text-primary">{{ command.name }}</span>
                <span
                  v-if="
                    command.kind === 'skill'
                      ? command.path || command.description
                      : command.description
                  "
                  class="slash-command-meta ui-text-secondary"
                  :title="
                    command.kind === 'skill'
                      ? command.path || command.description
                      : command.description
                  "
                >
                  {{
                    command.kind === 'skill'
                      ? command.path || command.description
                      : command.description
                  }}
                </span>
              </button>
            </template>
          </div>
        </template>

        <template #toolbar-left>
          <ChatComposerSelectors
            :selected-workspace-id="props.selectedWorkspaceId ?? null"
            :workspace-locked="props.workspaceLocked"
            v-model:selected-skill-ids="selectedSkillIds"
            v-model:skill-mode="skillMode"
            v-model:selected-tools="selectedTools"
            v-model:selected-mcp-server-ids="selectedMcpServerIds"
            v-model:tool-mode="toolMode"
            v-model:autonomous-active="isAutonomousMode"
            v-model:autonomous-max-iterations="autonomousMaxIterations"
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
            :run-active="runStatusState.isActive.value"
            :run-status="runStatusState.currentStatus.value"
            :autonomous-active="isAutonomousMode"
            @toggle-incognito="toggleIncognitoMode"
            @toggle-voice-input="toggleVoiceInput"
            @send-message="sendMessage"
            @stop-streaming="stopStreaming"
          />
        </template>

        <template #image-previews>
          <div v-if="attachedImages.length > 0" class="image-preview-strip" aria-label="Attached images">
            <div
              v-for="(file, index) in attachedImages"
              :key="index"
              class="image-preview-chip"
              @click="viewerSrc = file.url"
            >
              <img
                :src="file.url"
                :alt="file.filename || 'Attached image'"
                class="image-preview-thumb"
              />
              <button
                type="button"
                class="image-preview-dismiss"
                :aria-label="t('common.remove')"
                @click.stop="removeAttachedImage(index)"
              >
                <span aria-hidden="true">x</span>
              </button>
            </div>
          </div>
          <div v-if="showVisionWarning" class="vision-warning" role="alert">
            {{ t('chat.input.visionWarning') }}
          </div>
        </template>
      </ChatComposerShell>
    </div>
    <ImageViewerOverlay
      :visible="viewerSrc.length > 0"
      :src="viewerSrc"
      @close="viewerSrc = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watchEffect } from 'vue';
import type { FileUIPart } from 'ai';
import type { Provider } from '@iki/backend/types/provider';
import type { TaskPlan } from '@iki/backend/types/task_plan';
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
import ChatSteerBar from './ChatSteerBar.vue';
import ImageViewerOverlay from './ImageViewerOverlay.vue';
import { useChatComposerDraft } from '../composables/useChatComposerDraft';
import { useChatComposerLifecycle } from '../composables/useChatComposerLifecycle';
import { useChatComposerSend } from '../composables/useChatComposerSend';
import { useChatProviderSelection } from '../composables/useChatProviderSelection';
import {
  useChatSlashCommands,
  type ComposerSlashCommand,
} from '../composables/useChatSlashCommands';
import { useSpeechInput } from '../composables/useSpeechInput';
import { useThreadToolSelection } from '../composables/useThreadToolSelection';
import { useRunStatus } from '../composables/useRunStatus';
import { useI18n } from '../i18n';
import { getElectronAPI } from '../services/electron_api';

const electronAPI = getElectronAPI();
const { t } = useI18n();
const emit = defineEmits<{
  (event: 'incognito-changed', value: boolean): void;
  (event: 'model-selected', payload: { model: string; provider: Provider }): void;
  (event: 'new-chat-requested'): void;
  (event: 'clear-thread-requested'): void;
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

type ComposerTextControl = HTMLInputElement | HTMLTextAreaElement;
type ComposerInlineToken = {
  id: string;
  prefix: string;
  label: string;
  title: string;
  toneClass: string;
  kind: 'active-invocation' | 'selected-skill';
  skillId?: string;
};

const inputRef = ref<ComposerTextControl | null>(null);
const setInputRef = (element: ComposerTextControl | null) => {
  inputRef.value = element;
};
const message = ref('');
const attachedImages = ref<FileUIPart[]>([]);
const viewerSrc = ref('');

const modelSupportsVision = computed(
  () => selectedModelCapability.value?.supportsVision === true
);

const showVisionWarning = computed(
  () => attachedImages.value.length > 0 && !modelSupportsVision.value
);
const isBusy = ref(false);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');
const isAutonomousMode = ref(false);
const autonomousMaxIterations = ref(10);

const runStatusState = useRunStatus({ electronAPI });

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
  audioEmotion,
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
  suggestions: slashCommandSuggestions,
  activeSuggestionIndex: activeSlashCommandIndex,
  isMenuVisible: isSlashCommandMenuVisible,
  activeInvocation,
  selectedSkills,
  applySuggestion: applySlashCommandSuggestion,
  clearActiveInvocation,
  handleComposerKeydown: handleSlashCommandKeydown,
  resolveSlashCommandSend,
} = useChatSlashCommands({
  electronAPI,
  message,
  inputRef,
  threadId: computed(() => props.threadId),
  currentIncognito: computed(() => Boolean(props.isIncognito)),
  selectedSkillIds,
  onRequestNewChat: () => emit('new-chat-requested'),
  onRequestClearThread: () => emit('clear-thread-requested'),
  onRequestIncognitoChange: (nextValue: boolean) => emit('incognito-changed', nextValue),
  t,
});

const handlePasteImage = (payload: { mediaType: string; url: string; filename?: string }) => {
  attachedImages.value = [
    ...attachedImages.value,
    { type: 'file' as const, mediaType: payload.mediaType, url: payload.url, filename: payload.filename },
  ];
};

const handleDropImages = (payloads: { mediaType: string; url: string; filename?: string }[]) => {
  attachedImages.value = [
    ...attachedImages.value,
    ...payloads.map(p => ({
      type: 'file' as const,
      mediaType: p.mediaType,
      url: p.url,
      filename: p.filename,
    })),
  ];
};

const removeAttachedImage = (index: number) => {
  attachedImages.value = attachedImages.value.filter((_, i) => i !== index);
};

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
  isAutonomousMode,
  autonomousMaxIterations,
  prepareFailedMessage: t('chat.input.prepareFailed'),
  stopFailedMessage: t('chat.input.stopFailed'),
  prepareMessageSend: props.prepareMessageSend,
  resolveSendRequest: resolveSlashCommandSend,
  canResolveEmptyDraft: () => activeInvocation.value !== null,
  ensureProviderReady,
  resolveSelectedMcpServerIds,
  stopVoiceInput,
  attachedImages,
  audioEmotion,
});
sendMessageHandler = sendMessage;
watchEffect(() => {
  isBusy.value = isPreparingSend.value || isLoading.value;
});

const getInvocationToneClass = (command: ComposerSlashCommand) => {
  if (command.kind === 'skill') return 'composer-inline-token--skill';
  if (command.kind === 'prompt-app') return 'composer-inline-token--prompt';
  return 'composer-inline-token--command';
};

const getInvocationPrefix = (command: ComposerSlashCommand) => {
  if (command.kind === 'skill') return '$';
  if (command.kind === 'prompt-app') return '';
  return '/';
};

const getInvocationLabel = (command: ComposerSlashCommand) => {
  if (command.kind === 'builtin' || command.kind === 'prompt-app') {
    return command.shortcut;
  }

  return command.name;
};

const selectedSkillTokens = computed<ComposerInlineToken[]>(() => {
  if (activeInvocation.value?.kind === 'skill') {
    return [];
  }

  return selectedSkills.value.map(skill => ({
    id: `selected-skill:${skill.id}`,
    prefix: '$',
    label: skill.name,
    title: skill.description || skill.path || skill.id,
    toneClass: 'composer-inline-token--skill',
    kind: 'selected-skill',
    skillId: skill.id,
  }));
});

const inlineComposerTokens = computed<ComposerInlineToken[]>(() => {
  const tokens: ComposerInlineToken[] = [];

  if (activeInvocation.value) {
    tokens.push({
      id: `active-invocation:${activeInvocation.value.id}`,
      prefix: getInvocationPrefix(activeInvocation.value),
      label: getInvocationLabel(activeInvocation.value),
      title:
        activeInvocation.value.kind === 'skill'
          ? activeInvocation.value.description ||
            activeInvocation.value.path ||
            activeInvocation.value.name
          : activeInvocation.value.description || activeInvocation.value.name,
      toneClass: getInvocationToneClass(activeInvocation.value),
      kind: 'active-invocation',
    });
  }

  return [...tokens, ...selectedSkillTokens.value];
});

const composerPlaceholder = computed(() => {
  if (activeInvocation.value?.kind === 'skill') {
    return t('chat.input.placeholder.skillInvocation', { skill: activeInvocation.value.name });
  }
  if (activeInvocation.value?.kind === 'prompt-app') {
    return t('chat.input.placeholder.promptInvocation', { name: activeInvocation.value.name });
  }
  if (activeInvocation.value?.kind === 'builtin') {
    return t('chat.input.placeholder.commandInvocation', { name: activeInvocation.value.name });
  }
  if (selectedSkills.value.length > 0) {
    return t('chat.input.placeholder.skillsActive');
  }
  return t('chat.input.placeholder');
});

const removeSelectedSkill = (skillId: string) => {
  selectedSkillIds.value = selectedSkillIds.value.filter(id => id !== skillId);
  skillMode.value = 'manual';
};

const handleInlineTokenClick = (token: ComposerInlineToken) => {
  if (token.kind === 'active-invocation') {
    clearActiveInvocation();
  } else if (token.skillId) {
    removeSelectedSkill(token.skillId);
  }

  inputRef.value?.focus();
};

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

const handleComposerKeydown = (event: KeyboardEvent) => {
  if (handleSlashCommandKeydown(event)) {
    return;
  }

  if (event.defaultPrevented || event.key !== 'Backspace' || message.value.length > 0) {
    return;
  }

  if (activeInvocation.value) {
    event.preventDefault();
    clearActiveInvocation();
    return;
  }

  const lastSelectedSkill = selectedSkills.value.at(-1);
  if (!lastSelectedSkill) {
    return;
  }

  event.preventDefault();
  removeSelectedSkill(lastSelectedSkill.id);
};

const shouldShowSkillSectionLabel = (index: number) => {
  const command = slashCommandSuggestions.value[index];
  if (command?.kind !== 'skill') return false;

  const previousCommand = slashCommandSuggestions.value[index - 1];
  return previousCommand?.kind !== 'skill';
};

const handleSteer = async (message: string) => {
  try {
    await electronAPI.chat.steerStream(props.threadId, message);
  } catch {
    // steer failed silently — the stream may have already ended
  }
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

.composer-inline-tokens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.composer-inline-token {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  min-width: 0;
  max-width: min(100%, 280px);
  border: 1px solid color-mix(in srgb, var(--accent-color) 18%, var(--border-color));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 9%, var(--bg-secondary));
  padding: 3px 8px 3px 7px;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;
}

.composer-inline-token:hover {
  border-color: color-mix(in srgb, var(--accent-color) 28%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
}

.composer-inline-token:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 18%, transparent);
}

.composer-inline-token-prefix,
.composer-inline-token-label {
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    Liberation Mono,
    Courier New,
    monospace;
}

.composer-inline-token-prefix {
  flex: 0 0 auto;
  opacity: 0.82;
  font-size: 10px;
  font-weight: 500;
}

.composer-inline-token-label {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-inline-token-dismiss {
  flex: 0 0 auto;
  opacity: 0.42;
  font-size: 9px;
  font-weight: 500;
  line-height: 1;
  transition: opacity 0.18s ease;
}

.composer-inline-token:hover .composer-inline-token-dismiss,
.composer-inline-token:focus-visible .composer-inline-token-dismiss {
  opacity: 0.72;
}

.composer-inline-token--skill {
  color: color-mix(in srgb, var(--accent-color) 86%, var(--text-primary));
  border-color: color-mix(in srgb, var(--accent-color) 22%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 11%, var(--bg-secondary));
}

.composer-inline-token--prompt {
  color: color-mix(in srgb, var(--accent-color) 72%, var(--text-primary));
  border-color: color-mix(in srgb, var(--accent-color) 18%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 7%, var(--bg-secondary));
}

.composer-inline-token--command {
  color: color-mix(in srgb, var(--warning-color) 82%, var(--text-primary));
  border-color: color-mix(in srgb, var(--warning-color) 24%, var(--border-color));
  background: color-mix(in srgb, var(--warning-color) 10%, var(--bg-secondary));
}

.slash-command-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  z-index: 2;
  display: grid;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 18%, var(--border-color));
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-secondary) 94%, var(--bg-tertiary)),
    color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary))
  );
  box-shadow:
    var(--surface-shadow-lg),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

.slash-command-item {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
  width: 100%;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.slash-command-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 2px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.slash-command-section-label::after {
  content: '';
  min-width: 0;
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}

.slash-command-item:hover,
.slash-command-item.is-active {
  border-color: color-mix(in srgb, var(--accent-color) 26%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-secondary));
}

.slash-command-shortcut {
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    Liberation Mono,
    Courier New,
    monospace;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.slash-command-name {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.slash-command-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.25;
}

.image-preview-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 4px;
}

.image-preview-chip {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.image-preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: pointer;
}

.image-preview-dismiss {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.14s ease;
}

.image-preview-chip:hover .image-preview-dismiss {
  opacity: 1;
}

.vision-warning {
  width: 100%;
  padding: 5px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--warning-color) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning-color) 22%, transparent);
  color: color-mix(in srgb, var(--warning-color) 90%, var(--text-primary));
  font-size: 12px;
  line-height: 1.45;
}
</style>
