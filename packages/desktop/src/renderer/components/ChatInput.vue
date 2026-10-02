<template>
  <div class="chat-input-outer">
    <!-- Width is owned by the parent (.composer-area tracks the chat column). -->
    <div>
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
            <PopoverContent
              class="permission-panel"
              side="top"
              align="start"
              :side-offset="8"
            >
              <p class="permission-panel-title">{{ t('chat.input.permission.panelTitle') }}</p>
              <div role="radiogroup" :aria-label="t('chat.input.permission.panelTitle')">
                <button
                  v-for="option in permissionOptions"
                  :key="option.value"
                  class="permission-option"
                  :class="{ 'permission-option--selected': approvalPolicy === option.value }"
                  role="radio"
                  :aria-checked="approvalPolicy === option.value"
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
              <HoverCardContent class="context-usage-panel" side="top" align="end" :side-offset="10">
                <div class="context-usage-panel-header">
                  <span class="context-usage-panel-title">{{ t('chat.contextUsage.panelTitle') }}</span>
                  <span class="context-usage-panel-total">{{ composerContextUsage.tokenLabel }}</span>
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
                    <span class="context-usage-row-label">{{ t(`chat.contextUsage.category.${row.key}`) }}</span>
                    <span class="context-usage-row-values">
                      <span class="context-usage-row-tokens">{{ formatTokenCount(row.tokens) }}</span>
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
import { computed, ref, watchEffect } from 'vue';
import type { Component } from 'vue';
import type { FileUIPart } from 'ai';
import { Check, Hand, Settings, ShieldCheck, Zap } from 'lucide-vue-next';
import type { Provider } from '@iki/backend/types/provider';
import type { TaskPlan } from '@iki/backend/types/task_plan';
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
import ChatTodoPlan from './chat/ChatTodoPlan.vue';
import ChatComposerActions from './ChatComposerActions.vue';
import ChatModelSelector from './ChatModelSelector.vue';
import ChatComposerShell from './ChatComposerShell.vue';
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
import { useRunStatus } from '../composables/useRunStatus';
import { useThreadSessionStore } from '../store/thread_session';
import { useConfigStore } from '../store/config';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import {
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger,
} from 'reka-ui';
import {
  parseApprovalPolicy,
  type ThreadApprovalPolicy,
} from '@iki/backend/workspaces/thread_mode';
import { storeToRefs } from 'pinia';
import { resolveThreadWorkMode } from '@iki/backend/workspaces/thread_mode';
import { useI18n } from '../i18n';
import { getElectronAPI } from '../services/electron_api';

const electronAPI = getElectronAPI();
const { t } = useI18n();
const threadSession = useThreadSessionStore();
const configStore = useConfigStore();
const autoApproveEnabled = computed(() => configStore.config?.general?.autoApproveToolRequests === true);
const approvalPolicy = computed(() => props.approvalPolicy ?? '');
const permissionPanelOpen = ref(false);

const permissionOptions = computed<
  { value: string; icon: Component; name: string; description: string }[]
>(() => [
  {
    value: '',
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
  void threadSession.setApprovalPolicy(parseApprovalPolicy(value) ?? '');
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

// Plain chats have no workspace concept — the composer no longer renders a
// picker, but work threads still need one, so the send-guard below remains.
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
  todoPlan?: TaskPlan | null;
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
const attachedImages = ref<FileUIPart[]>([]);
const viewerSrc = ref('');

const modelSupportsVision = computed(
  () => selectedModelCapability.value?.supportsVision === true
);

const showVisionWarning = computed(
  () => attachedImages.value.length > 0 && !modelSupportsVision.value
);
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
// Session-cumulative weighted average (same aggregation as the stats bar).
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
<style scoped>
.chat-input-outer {
  padding: var(--chat-composer-padding, 10px);
}

.composer-context-ring {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  align-self: center;
  margin-right: -2px;
  user-select: none;
  cursor: default;
}

.composer-context-ring svg {
  display: block;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.composer-context-ring-track,
.composer-context-ring-arc {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
}

.composer-context-ring-track {
  stroke: color-mix(in srgb, var(--text-muted) 32%, transparent);
}

.composer-context-ring-arc {
  stroke: var(--text-muted);
  transition:
    stroke-dashoffset 0.3s ease,
    stroke 0.3s ease;
}

.composer-context-ring.is-warning .composer-context-ring-arc {
  stroke: var(--warning-color);
}

.composer-context-ring.is-danger .composer-context-ring-arc {
  stroke: var(--danger-color);
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
  font-family: var(--font-mono);
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
  font-family: var(--font-mono);
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
  background: var(--image-overlay-control-bg);
  color: var(--image-overlay-control-ink);
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
