<template>
  <div class="message-wrapper" :class="message.role">
    <div class="message-shell">
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

      <div v-if="message.role === 'user'" class="message-actions">
        <button
          class="message-action-btn"
          type="button"
          :data-tooltip="t('chat.edit.label')"
          :aria-label="t('chat.edit.label')"
          @click.stop="emit('edit-user-message', message)"
        >
          <Pencil class="message-action-icon" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Pencil } from 'lucide-vue-next';
import type { ChatUiMessage } from '../../../shared/chat/message_parts';
import { useI18n } from '../../i18n';

import ChatMessageReferences from './ChatMessageReferences.vue';
import ChatMessageParts from './ChatMessageParts.vue';

defineProps<{
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
  (event: 'edit-user-message', message: ChatUiMessage): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.message-wrapper {
  margin-bottom: var(--chat-message-gap, 18px);
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
  justify-content: flex-start;
  gap: 8px;
  position: absolute;
  left: 10px;
  bottom: -18px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: 10;
}

.message-wrapper.user .message-content:hover + .message-actions,
.message-wrapper.user .message-actions:hover {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-btn {
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-tertiary) 82%, transparent);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.message-action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
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

.message-action-btn:hover::after {
  opacity: 1;
  transform: translate(-50%, 0);
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
}
</style>
