<template>
  <div class="message-wrapper" :class="message.role">
    <div
      class="message-shell"
      @mouseenter="showActions"
      @mouseleave="scheduleHideActions"
      @focusin="showActions"
    >
      <ChatMessageReferences v-if="message.role === 'assistant'" :message="message" />

      <div class="message-content">
        <ChatMessageParts
          :message="message"
          :message-index="messageIndex"
          :active-assistant-message-id="activeAssistantMessageId"
          :stream-render-tick="streamRenderTick"
          :approval-processing="approvalProcessing"
          :get-mcp-server-label="getMcpServerLabel"
          @approve-tool="emit('approve-tool', $event)"
        />
      </div>

      <div
        v-if="message.role === 'user'"
        class="message-actions"
        :class="{ 'actions-visible': areActionsVisible }"
        :data-menu-open="isMoreMenuOpen ? 'true' : undefined"
        @mouseenter="showActions"
        @mouseleave="scheduleHideActions"
        @focusout="handleActionsFocusOut"
        @keydown.escape.stop.prevent="closeMoreMenu"
      >
        <button
          class="message-action-btn"
          type="button"
          :class="{ copied: copyFeedbackVisible }"
          :data-tooltip="copyTooltip"
          :data-copied="copyFeedbackVisible ? 'true' : undefined"
          :aria-label="copyTooltip"
          @click.stop="handleCopyMessage"
        >
          <Copy class="message-action-icon" :size="14" />
        </button>
        <button
          class="message-action-btn"
          type="button"
          :data-tooltip="t('chat.regenerate.label')"
          :aria-label="t('chat.regenerate.label')"
          @click.stop="handleRegenerate"
        >
          <RotateCcw class="message-action-icon" :size="14" />
        </button>
        <button
          class="message-action-btn"
          type="button"
          :data-tooltip="t('chat.edit.label')"
          :aria-label="t('chat.edit.label')"
          @click.stop="handleEdit"
        >
          <Pencil class="message-action-icon" :size="14" />
        </button>
        <div class="message-more-shell">
          <button
            class="message-action-btn"
            type="button"
            :data-tooltip="t('chat.more.label')"
            :aria-label="t('chat.more.label')"
            aria-haspopup="menu"
            :aria-expanded="isMoreMenuOpen"
            @click.stop="toggleMoreMenu"
          >
            <MoreHorizontal class="message-action-icon" :size="14" />
          </button>

          <div v-if="isMoreMenuOpen" class="message-more-menu" role="menu">
            <button
              class="message-more-menu-item"
              type="button"
              role="menuitem"
              @click="handleCopyMessage"
            >
              {{ t('chat.copy.label') }}
            </button>
            <button
              class="message-more-menu-item"
              type="button"
              role="menuitem"
              @click="handleRegenerate"
            >
              {{ t('chat.regenerate.label') }}
            </button>
            <button
              class="message-more-menu-item"
              type="button"
              role="menuitem"
              @click="handleEdit"
            >
              {{ t('chat.edit.label') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Copy, MoreHorizontal, Pencil, RotateCcw } from 'lucide-vue-next';
import type { ChatUiMessage } from '../../../shared/chat/message_parts';
import { copyTextToClipboard } from '../../composables/useMarkdownCopy';
import { useI18n } from '../../i18n';
import { extractTextFromMessage } from '../../modules/chat/ui_message_text';

import ChatMessageReferences from './ChatMessageReferences.vue';
import ChatMessageParts from './ChatMessageParts.vue';

const props = defineProps<{
  message: ChatUiMessage;
  messageIndex: number;
  activeAssistantMessageId: string | null;
  streamRenderTick: number;
  approvalProcessing: (part: unknown) => boolean;
  getMcpServerLabel: (part: unknown) => string;
}>();

const emit = defineEmits<{
  (
    event: 'approve-tool',
    payload: {
      approved: boolean;
      message: ChatUiMessage;
      part: unknown;
    }
  ): void;
  (event: 'regenerate-user-message', message: ChatUiMessage): void;
  (event: 'edit-user-message', message: ChatUiMessage): void;
}>();

const { t } = useI18n();
const ACTIONS_HIDE_DELAY_MS = 160;
const isMoreMenuOpen = ref(false);
const areActionsVisible = ref(false);
const copyFeedbackVisible = ref(false);
const messageText = computed(() => extractTextFromMessage(props.message));
const copyTooltip = computed(() =>
  copyFeedbackVisible.value ? t('chat.copy.copied') : t('chat.copy.label')
);

let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let hideActionsTimer: ReturnType<typeof setTimeout> | null = null;

const clearCopyFeedbackTimer = () => {
  if (!copyFeedbackTimer) return;
  clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = null;
};

const clearHideActionsTimer = () => {
  if (!hideActionsTimer) return;
  clearTimeout(hideActionsTimer);
  hideActionsTimer = null;
};

const showActions = () => {
  clearHideActionsTimer();
  areActionsVisible.value = true;
};

const scheduleHideActions = () => {
  clearHideActionsTimer();
  if (isMoreMenuOpen.value) return;
  hideActionsTimer = setTimeout(() => {
    if (!isMoreMenuOpen.value) {
      areActionsVisible.value = false;
    }
    hideActionsTimer = null;
  }, ACTIONS_HIDE_DELAY_MS);
};

const closeMoreMenu = () => {
  isMoreMenuOpen.value = false;
};

const toggleMoreMenu = () => {
  showActions();
  isMoreMenuOpen.value = !isMoreMenuOpen.value;
};

const handleCopyMessage = async () => {
  closeMoreMenu();
  const copied = await copyTextToClipboard(messageText.value);
  if (!copied) return;

  clearCopyFeedbackTimer();
  copyFeedbackVisible.value = true;
  copyFeedbackTimer = setTimeout(() => {
    copyFeedbackVisible.value = false;
    copyFeedbackTimer = null;
  }, 1200);
};

const handleRegenerate = () => {
  closeMoreMenu();
  emit('regenerate-user-message', props.message);
};

const handleEdit = () => {
  closeMoreMenu();
  emit('edit-user-message', props.message);
};

const handleActionsFocusOut = (event: FocusEvent) => {
  const currentTarget = event.currentTarget;
  const nextTarget = event.relatedTarget;
  if (!(currentTarget instanceof HTMLElement)) {
    closeMoreMenu();
    return;
  }
  if (nextTarget instanceof Node && currentTarget.contains(nextTarget)) {
    return;
  }
  closeMoreMenu();
  if (!currentTarget.matches(':hover')) {
    scheduleHideActions();
  }
};

onBeforeUnmount(() => {
  clearCopyFeedbackTimer();
  clearHideActionsTimer();
});
</script>

<style scoped>
.message-wrapper {
  margin-bottom: var(--chat-message-gap, 18px);
}

.message-wrapper.user {
  margin-bottom: calc(var(--chat-message-gap, 18px) + 24px);
}

.message-shell {
  position: relative;
  min-width: 0;
}

.message-wrapper.user .message-shell {
  margin-left: auto;
  width: fit-content;
  max-width: min(85%, 760px);
}

.message-wrapper.assistant .message-shell {
  max-width: min(100%, 760px);
  margin-right: clamp(0px, 4vw, 56px);
}

.message-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  position: absolute;
  right: 10px;
  bottom: -36px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: 10;
}

.message-wrapper.user .message-actions.actions-visible,
.message-wrapper.user .message-actions[data-menu-open='true'] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.message-action-btn:hover,
.message-action-btn:focus-visible,
.message-action-btn[aria-expanded='true'] {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-hover) 88%, transparent);
  outline: none;
}

.message-action-btn[data-copied='true'],
.message-action-btn.copied {
  color: var(--success-color, var(--accent-color));
}

.message-action-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  white-space: nowrap;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  box-shadow: var(--surface-shadow-md);
  color: var(--text-primary);
  font-size: 12px;
  letter-spacing: 0.01em;
  opacity: 0;
  transform: translate(-50%, 4px);
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.message-action-btn:hover::after,
.message-action-btn:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.message-more-shell {
  position: relative;
  display: flex;
}

.message-actions::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 12px;
}

.message-more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  min-width: 156px;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  box-shadow: var(--surface-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.message-more-menu-item {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 8px 10px;
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.35;
}

.message-more-menu-item:hover,
.message-more-menu-item:focus-visible {
  color: var(--text-primary);
  background: var(--bg-hover);
  outline: none;
}

.message-action-icon {
  display: block;
}

.message-wrapper.user .message-content {
  background: var(--chat-user-bubble-background);
  border: 1px solid var(--chat-user-bubble-border-color);
  border-radius: var(--chat-user-bubble-radius, 28px);
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
  box-shadow: var(--chat-user-bubble-shadow);
}

.message-wrapper.assistant .message-content {
  background: var(--bg-primary);
  border-radius: 12px;
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
}

@media (max-width: 768px) {
  .message-wrapper.user .message-shell,
  .message-wrapper.assistant .message-shell {
    max-width: 100%;
  }

  .message-wrapper.assistant .message-shell {
    margin-right: 0;
  }

  .message-actions {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  .message-wrapper.user {
    margin-bottom: calc(var(--chat-message-gap, 18px) + 28px);
  }
}
</style>
