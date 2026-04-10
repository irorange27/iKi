<template>
  <div class="composer-toolbar-right flex items-center gap-2">
    <div
      v-if="contextUsage"
      class="composer-context-indicator"
      :title="contextUsage.tooltip"
      :aria-label="t('chat.input.contextUsage')"
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
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" d="M12 14l3-3" />
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
      :disabled="props.isPreparingSend || props.isLoading || props.isStopping"
      @click="$emit('toggle-incognito')"
    >
      <svg
        v-if="props.isIncognito"
        class="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18" />
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

    <div v-if="props.showWaveform" class="speech-waveform" aria-hidden="true">
      <span
        v-for="(bar, idx) in props.waveformBars"
        :key="idx"
        class="speech-waveform-bar"
        :style="{ height: `${Math.max(18, Math.round(bar * 100))}%` }"
      />
    </div>

    <button
      class="composer-icon-btn speech-btn h-8 w-8 rounded-lg flex items-center justify-center"
      :class="[
        props.isRecording
          ? 'ui-text-danger'
          : props.isTranscribing
            ? 'ui-text-accent'
            : props.speechEngineAvailable
              ? 'ui-text-secondary'
              : 'ui-text-muted speech-btn-unavailable',
        props.isTranscribing ? 'is-transcribing' : '',
      ]"
      :disabled="
        !props.speechEngineAvailable ||
        props.isPreparingSend ||
        props.isLoading ||
        props.isStopping ||
        props.isTranscribing
      "
      :aria-label="props.isRecording ? t('chat.input.voiceStop') : t('chat.input.voiceStart')"
      :title="voiceInputTooltip"
      @click="$emit('toggle-voice-input')"
    >
      <svg v-if="props.isRecording" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
      <svg
        v-else-if="props.isTranscribing"
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
      v-if="props.speechStatusLabel"
      class="text-[10px] whitespace-nowrap"
      :class="props.speechStatusToneClass"
    >
      {{ props.speechStatusLabel }}
    </span>
    <button
      class="composer-icon-btn send-btn h-8 w-8 rounded-lg flex items-center justify-center"
      :class="[
        props.isLoading ? 'ui-text-danger stop-btn' : 'ui-text-accent',
        props.isStopping ? 'is-stopping' : '',
      ]"
      :aria-label="props.isLoading ? t('chat.input.stopGeneration') : t('chat.input.send')"
      :title="sendButtonTooltip"
      :disabled="
        props.isPreparingSend || props.isStopping || props.isRecording || props.isTranscribing
      "
      @click="props.isLoading ? $emit('stop-streaming') : $emit('send-message')"
    >
      <svg
        v-if="props.isLoading"
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
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { ContextUsageIndicator } from '../modules/chat/ui_message_references';
import { useI18n } from '../i18n';

const props = defineProps<{
  contextUsage?: ContextUsageIndicator | null;
  isIncognito?: boolean;
  isPreparingSend: boolean;
  isLoading: boolean;
  isStopping: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  speechEngineAvailable: boolean;
  showWaveform: boolean;
  waveformBars: number[];
  speechStatusLabel: string;
  speechStatusToneClass: string;
}>();

defineEmits<{
  (event: 'toggle-incognito'): void;
  (event: 'toggle-voice-input'): void;
  (event: 'send-message'): void;
  (event: 'stop-streaming'): void;
}>();

const { t } = useI18n();
const incognitoAriaLabel = computed(() =>
  props.isIncognito ? t('chat.input.disableIncognito') : t('chat.input.enableIncognito')
);
const incognitoTooltip = computed(() =>
  props.isIncognito ? t('chat.input.incognitoOn') : t('chat.input.incognitoOff')
);
const voiceInputTooltip = computed(() =>
  props.isRecording ? t('chat.input.voiceStop') : t('chat.input.voiceStart')
);
const sendButtonTooltip = computed(() =>
  props.isLoading ? t('chat.input.stopGeneration') : t('chat.input.send')
);
</script>

<style scoped>
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
