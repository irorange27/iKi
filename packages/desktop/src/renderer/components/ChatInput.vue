<template>
  <div class="chat-input-outer">
    <!-- Width is owned by the parent (.composer-area tracks the chat column). -->
    <div>
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
          <PopoverRoot v-model:open="permissionPanelOpen">
            <PopoverTrigger as-child>
              <button
                class="composer-permission-chip"
                :class="{ 'composer-permission-chip--auto': approvalPolicy === 'never' }"
                :title="t('chat.input.permission.title')"
              >
                <ShieldCheck class="h-3.5 w-3.5" />
                <span>{{ permissionChipLabel }}</span>
              </button>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent class="permission-panel" side="top" align="start" :side-offset="8">
                <p class="permission-panel-title">{{ t('chat.input.permission.panelTitle') }}</p>
                <div role="radiogroup" :aria-label="t('chat.input.permission.panelTitle')">
                  <button
                    v-for="option in permissionOptions"
                    :key="option.value"
                    class="permission-option"
                    :class="{ 'permission-option--selected': approvalPolicy === option.value }"
                    role="radio"
                    :aria-checked="approvalPolicy === option.value"
                    :data-policy="option.value"
                    @click="selectApprovalPolicy(option.value)"
                  >
                    <span class="permission-option-icon" aria-hidden="true">
                      <component :is="option.icon" class="h-4 w-4" />
                    </span>
                    <span class="permission-option-copy">
                      <span class="permission-option-name">{{ option.name }}</span>
                      <span class="permission-option-desc">{{ option.description }}</span>
                    </span>
                    <Check
                      v-if="approvalPolicy === option.value"
                      class="permission-option-check h-4 w-4"
                    />
                  </button>
                </div>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
        </template>

        <template #toolbar-right>
          <HoverCardRoot v-if="composerContextUsage" :open-delay="150" :close-delay="80">
            <HoverCardTrigger as-child>
              <div
                class="composer-context-ring"
                :class="contextRingToneClass"
                role="status"
                :aria-label="t('chat.input.contextUsage')"
                tabindex="0"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle class="composer-context-ring-track" cx="10" cy="10" r="8" />
                  <circle
                    class="composer-context-ring-arc"
                    cx="10"
                    cy="10"
                    r="8"
                    :stroke-dasharray="contextRingCircumference"
                    :stroke-dashoffset="contextRingOffset"
                  />
                </svg>
              </div>
            </HoverCardTrigger>
            <HoverCardPortal>
              <HoverCardContent
                class="context-usage-panel"
                side="top"
                align="end"
                :side-offset="10"
              >
                <div class="context-usage-panel-header">
                  <span class="context-usage-panel-title">{{
                    t('chat.contextUsage.panelTitle')
                  }}</span>
                  <span class="context-usage-panel-total">{{
                    composerContextUsage.tokenLabel
                  }}</span>
                </div>
                <div class="context-usage-panel-bar" role="presentation">
                  <div
                    class="context-usage-panel-bar-fill"
                    :class="contextRingToneClass"
                    :style="{ width: contextPanelBarWidth }"
                  ></div>
                </div>
                <ul v-if="contextCompositionRows.length > 0" class="context-usage-panel-rows">
                  <li
                    v-for="row in contextCompositionRows"
                    :key="row.key"
                    class="context-usage-panel-row"
                  >
                    <span class="context-usage-row-label">{{
                      t(`chat.contextUsage.category.${row.key}`)
                    }}</span>
                    <span class="context-usage-row-values">
                      <span class="context-usage-row-tokens">{{
                        formatTokenCount(row.tokens)
                      }}</span>
                      <span class="context-usage-row-percent">{{ row.percent }}%</span>
                    </span>
                  </li>
                </ul>
                <p v-if="contextCacheHitRate !== null" class="context-usage-panel-cache">
                  <span>{{ t('chat.contextUsage.cacheHitRate') }}</span>
                  <span class="context-usage-row-percent">{{ contextCacheHitRate }}%</span>
                </p>
                <p v-if="contextCompositionRows.length > 0" class="context-usage-panel-note">
                  {{ t('chat.contextUsage.estimatedNote') }}
                </p>
              </HoverCardContent>
            </HoverCardPortal>
          </HoverCardRoot>
          <ChatModelSelector
            :available-providers="availableProviders"
            :selected-provider="selectedProvider"
            :selected-model="selectedModel"
            :reasoning-effort="currentReasoningEffort"
            @select="handleProviderModelSelect"
            @update:reasoning-effort="handleReasoningEffortChanged"
          />
          <ChatComposerActions
            :is-incognito="isIncognito"
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
            @toggle-incognito="toggleIncognitoMode"
            @toggle-voice-input="toggleVoiceInput"
            @send-message="sendMessage"
            @stop-streaming="stopStreaming"
          />
        </template>

        <template #image-previews>
          <div
            v-if="attachedImages.length > 0"
            class="image-preview-strip"
            :aria-label="t('a11y.attachedImages')"
          >
            <div v-for="(file, index) in attachedImages" :key="index" class="image-preview-chip">
              <button
                type="button"
                class="image-preview-open"
                :aria-label="t('a11y.viewImage')"
                @click="viewerSrc = file.url"
              >
                <img
                  :src="file.url"
                  :alt="file.filename || 'Attached image'"
                  class="image-preview-thumb"
                />
              </button>
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
    <ImageViewerOverlay :visible="viewerSrc.length > 0" :src="viewerSrc" @close="viewerSrc = ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import type { Component } from 'vue';
import { Check, Hand, Settings, ShieldCheck, Zap } from 'lucide-vue-next';
import type { Provider } from '@iki/core/types/provider';
import {
  buildContextCompositionRows,
  buildTokenUsageIndicator,
  formatTokenCount,
  type SessionPerfStats,
  type TokenUsageSummary,
} from '../modules/chat/ui_message_references';
import type {
  PreparedMessageSend,
  PrepareMessageSendPayload,
} from '../modules/chat/chat_prepare_send';
import type { SubmitTurnParams, SubmitTurnResult } from '../composables/useChatComposerSend';
import ChatComposerActions from './ChatComposerActions.vue';
import ChatModelSelector from './ChatModelSelector.vue';
import ChatComposerShell from './ChatComposerShell.vue';
import ImageViewerOverlay from './ImageViewerOverlay.vue';
import { useChatComposerDraft } from '../composables/useChatComposerDraft';
import { useChatComposerAttachments } from '../composables/useChatComposerAttachments';
import { useChatComposerLifecycle } from '../composables/useChatComposerLifecycle';
import { useChatComposerSend } from '../composables/useChatComposerSend';
import { useChatProviderSelection } from '../composables/useChatProviderSelection';
import {
  useChatSlashCommands,
  type ComposerSlashCommand,
} from '../composables/useChatSlashCommands';
import { useSpeechInput } from '../composables/useSpeechInput';
import { useRunStatus } from '../composables/useRunStatus';
import { useThreadSessionStore } from '../store/thread_session';
import { useConfigStore } from '../store/config';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger , HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui';
import {
  parseApprovalPolicy,
 resolveThreadWorkMode } from '@iki/harness/workspaces/thread_mode';
import { storeToRefs } from 'pinia';
import { useI18n } from '../i18n';
import { getElectronAPI } from '../services/electron_api';

const electronAPI = getElectronAPI();
const { t } = useI18n();
const threadSession = useThreadSessionStore();
const configStore = useConfigStore();
const autoApproveEnabled = computed(
  () => configStore.config?.general?.autoApproveToolRequests === true
);
const approvalPolicy = computed(() => props.approvalPolicy ?? '');
const permissionPanelOpen = ref(false);

const permissionOptions = computed<
  { value: string; icon: Component; name: string; description: string }[]
>(() => [
  {
    value: 'askRisky',
    icon: Settings,
    name: t('chat.input.permission.defaultName'),
    description: t('chat.input.permission.defaultDesc'),
  },
  {
    value: 'always',
    icon: Hand,
    name: t('chat.input.permission.alwaysName'),
    description: t('chat.input.permission.alwaysDesc'),
  },
  {
    value: 'trustWorkspace',
    icon: ShieldCheck,
    name: t('chat.input.permission.trustName'),
    description: t('chat.input.permission.trustDesc'),
  },
  {
    value: 'never',
    icon: Zap,
    name: t('chat.input.permission.fullName'),
    description: t('chat.input.permission.fullDesc'),
  },
]);

const permissionChipLabel = computed(() => {
  if (approvalPolicy.value === 'never') return t('chat.input.permission.fullChip');
  if (approvalPolicy.value === 'trustWorkspace') return t('chat.input.permission.trustChip');
  if (approvalPolicy.value === 'always') return t('chat.input.permission.alwaysChip');
  return autoApproveEnabled.value
    ? t('chat.input.permission.auto')
    : t('chat.input.permission.ask');
});

const selectApprovalPolicy = (value: string) => {
  void threadSession.setApprovalPolicy(parseApprovalPolicy(value) ?? 'askRisky');
  permissionPanelOpen.value = false;
};
const {
  currentThread,
  isIncognito,
  currentModel: threadModel,
  currentProviderId,
  currentReasoningEffort,
  currentPersonality,
  selectedWorkspaceId: sessionSelectedWorkspaceId,
} = storeToRefs(threadSession);

const isWorkThread = computed(() => resolveThreadWorkMode(currentThread.value) === 'work');
const emit = defineEmits<{
  'new-chat-requested': [];
  'clear-thread-requested': [];
}>();

const props = defineProps<{
  threadId?: string;
  approvalPolicy?: string;
  prepareMessageSend?: (payload: PrepareMessageSendPayload) => Promise<PreparedMessageSend | null>;
  submitTurn: (params: SubmitTurnParams) => Promise<SubmitTurnResult>;
  latestTokenUsage?: TokenUsageSummary | null;
  sessionPerfStats?: SessionPerfStats | null;
}>();

type ComposerTextControl = HTMLInputElement | HTMLTextAreaElement;
type ComposerInlineToken = {
  id: string;
  prefix: string;
  label: string;
  title: string;
  toneClass: string;
  kind: 'active-invocation';
};

const inputRef = ref<ComposerTextControl | null>(null);
const setInputRef = (element: ComposerTextControl | null) => {
  inputRef.value = element;
};
const message = ref('');

const modelSupportsVision = computed(() => selectedModelCapability.value?.supportsVision === true);

const {
  attachedImages,
  viewerSrc,
  showVisionWarning,
  handlePasteImage,
  handleDropImages,
  removeAttachedImage,
} = useChatComposerAttachments({ modelSupportsVision });

const isBusy = ref(false);

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
  suggestions: slashCommandSuggestions,
  activeSuggestionIndex: activeSlashCommandIndex,
  isMenuVisible: isSlashCommandMenuVisible,
  activeInvocation,
  applySuggestion: applySlashCommandSuggestion,
  clearActiveInvocation,
  handleComposerKeydown: handleSlashCommandKeydown,
  resolveSlashCommandSend,
} = useChatSlashCommands({
  electronAPI,
  message,
  inputRef,
  threadId: computed(() => props.threadId),
  currentIncognito: isIncognito,
  currentPersonality,
  onRequestNewChat: () => emit('new-chat-requested'),
  onRequestClearThread: () => emit('clear-thread-requested'),
  onRequestIncognitoChange: (nextValue: boolean) => void threadSession.setIncognito(nextValue),
  onRequestPersonalityChange: (nextValue: string) => void threadSession.setPersonality(nextValue),
  t,
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
  reasoningEffort: currentReasoningEffort,
  personality: currentPersonality,
  approvalPolicy: computed(() => props.approvalPolicy ?? ''),
  ensureWorkspaceForWork: () => {
    if (!isWorkThread.value) return null;
    if (sessionSelectedWorkspaceId.value) return null;
    return t('chat.input.workNeedsWorkspace');
  },
  prepareFailedMessage: t('chat.input.prepareFailed'),
  stopFailedMessage: t('chat.input.stopFailed'),
  prepareMessageSend: props.prepareMessageSend,
  submitTurn: props.submitTurn,
  resolveSendRequest: resolveSlashCommandSend,
  canResolveEmptyDraft: () => activeInvocation.value !== null,
  ensureProviderReady,
  stopVoiceInput,
  attachedImages,
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

  return tokens;
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
  return t('chat.input.placeholder');
});

const handleInlineTokenClick = (token: ComposerInlineToken) => {
  if (token.kind === 'active-invocation') {
    clearActiveInvocation();
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
    lastStepInputTokens: latestUsage?.lastStepInputTokens ?? null,
    maxInputTokens:
      modelCapability?.maxInputTokens ??
      modelCapability?.contextWindow ??
      latestUsage?.maxInputTokens ??
      null,
    maxOutputTokens: modelCapability?.maxOutputTokens ?? latestUsage?.maxOutputTokens ?? null,
    model: selectedModel.value || latestUsage?.model || '',
    providerType: selectedProvider.value?.type || latestUsage?.providerType || '',
    providerId: selectedProvider.value?.id || latestUsage?.providerId || '',
    llmMs: latestUsage?.llmMs ?? null,
    toolMs: latestUsage?.toolMs ?? null,
    firstTokenMs: latestUsage?.firstTokenMs ?? null,
    firstTokenSamples: latestUsage?.firstTokenSamples ?? null,
    steps: latestUsage?.steps ?? null,
    toolCalls: latestUsage?.toolCalls ?? null,
    contextComposition: latestUsage?.contextComposition ?? null,
  });
});

const CONTEXT_RING_RADIUS = 8;
const contextRingCircumference = 2 * Math.PI * CONTEXT_RING_RADIUS;
const contextRingOffset = computed(() => {
  const percent = composerContextUsage.value?.percent;
  if (percent === null || percent === undefined) return contextRingCircumference;
  const fraction = Math.min(100, Math.max(0, percent)) / 100;
  return contextRingCircumference * (1 - fraction);
});
const contextRingToneClass = computed(() => {
  const percent = composerContextUsage.value?.percent ?? 0;
  if (percent >= 90) return 'is-danger';
  if (percent >= 70) return 'is-warning';
  return '';
});
const contextCompositionRows = computed(() =>
  buildContextCompositionRows(props.latestTokenUsage ?? null)
);
const contextCacheHitRate = computed(() => {
  const percent = props.sessionPerfStats?.cacheHitPercent ?? null;
  return percent === null ? null : Math.round(percent);
});
const contextPanelBarWidth = computed(() => {
  const percent = composerContextUsage.value?.percent;
  if (percent === null || percent === undefined) return '0%';
  return `${Math.min(100, Math.max(0, percent))}%`;
});

useChatComposerLifecycle({
  electronAPI,
  activeModel: threadModel,
  activeProviderId: currentProviderId,
  loadAvailableProviders,
  syncPreferredModel,
  loadSpeechStatus,
});

const handleProviderModelSelect = (payload: { provider: Provider; model: string }) => {
  dismissComposerFeedback();
  selectProviderModel(payload);
  threadSession.handleModelSelected(payload);
};

const toggleIncognitoMode = () => {
  if (isBusy.value || isStopping.value) return;
  void threadSession.setIncognito(!isIncognito.value);
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
  }
};

const shouldShowSkillSectionLabel = (index: number) => {
  const command = slashCommandSuggestions.value[index];
  if (command?.kind !== 'skill') return false;

  const previousCommand = slashCommandSuggestions.value[index - 1];
  return previousCommand?.kind !== 'skill';
};

const handleReasoningEffortChanged = (effort: string) => {
  void threadSession.setReasoningEffort(effort);
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
<style scoped src="./chat_input.css"></style>
