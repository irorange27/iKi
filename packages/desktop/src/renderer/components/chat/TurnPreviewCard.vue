<template>
  <Teleport to="body">
    <div
      v-if="anchor"
      class="turn-preview-card"
      :style="cardStyle"
      @mouseenter="emit('mouse-enter')"
      @mouseleave="emit('mouse-leave')"
      @click="emit('activate')"
    >
      <div v-if="title" class="turn-preview-title">{{ title }}</div>
      <div v-if="previewItems.length === 0" class="turn-preview-empty">
        {{ t('chat.turnPreview.empty') }}
      </div>
      <div v-else class="turn-preview-messages">
        <div
          v-for="(item, index) in previewItems"
          :key="index"
          class="turn-preview-message"
        >
          <span
            class="turn-preview-role"
            :class="`turn-preview-role--${item.role}`"
          >{{ item.roleLabel }}</span>
          <span class="turn-preview-snippet">{{ item.snippet }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import {
  type ChatUiMessage,
  extractTextFromMessageParts,
} from '@iki/backend/message/message_parts';
import { useI18n } from '../../i18n';

const PREVIEW_WIDTH = 340;
const PREVIEW_MAX_HEIGHT = 420;
const PREVIEW_MESSAGE_LIMIT = 6;
const SNIPPET_MAX_LENGTH = 220;
const VIEWPORT_MARGIN = 12;

const { t } = useI18n();

const props = defineProps<{
  title?: string | null;
  anchor: { top: number; left: number } | null;
  messages: ChatUiMessage[] | null;
}>();

const emit = defineEmits<{
  (event: 'activate'): void;
  (event: 'mouse-enter'): void;
  (event: 'mouse-leave'): void;
}>();

const previewItems = computed(() => {
  const messages = Array.isArray(props.messages) ? props.messages : [];
  const items: Array<{ role: 'user' | 'assistant'; roleLabel: string; snippet: string }> = [];
  for (let index = messages.length - 1; index >= 0 && items.length < PREVIEW_MESSAGE_LIMIT; index -= 1) {
    const message = messages[index];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    const snippet = extractTextFromMessageParts(message.parts)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SNIPPET_MAX_LENGTH);
    if (!snippet) continue;
    items.unshift({
      role: message.role,
      roleLabel:
        message.role === 'user'
          ? t('chat.turnPreview.roleUser')
          : t('chat.turnPreview.roleAssistant'),
      snippet,
    });
  }
  return items;
});

const cardStyle = computed(() => {
  if (!props.anchor) return {};
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(props.anchor.top, window.innerHeight - PREVIEW_MAX_HEIGHT - VIEWPORT_MARGIN)
  );
  return {
    left: `${props.anchor.left}px`,
    top: `${top}px`,
    width: `${PREVIEW_WIDTH}px`,
    maxHeight: `${PREVIEW_MAX_HEIGHT}px`,
  };
});
</script>

<style scoped>
.turn-preview-card {
  position: fixed;
  z-index: 90;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 14px 36px color-mix(in srgb, var(--text-primary) 14%, transparent);
  cursor: pointer;
}

.turn-preview-title {
  flex: 0 0 auto;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.turn-preview-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.turn-preview-message {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.turn-preview-role {
  align-self: flex-start;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  opacity: 0.85;
}

.turn-preview-role--user {
  color: var(--accent-color);
}

.turn-preview-snippet {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.turn-preview-empty {
  padding: 6px 0 2px;
  font-size: 12.5px;
  color: var(--text-secondary);
  opacity: 0.8;
}
</style>
