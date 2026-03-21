<template>
  <div class="chat-message-parts" :class="message.role">
    <div
      v-for="(part, partIndex) in message.parts"
      :key="getPartRenderKey(part, partIndex)"
      class="message-part"
    >
      <div v-if="isStreamingTextPart(part)" class="message-text">
        {{ getTextPartContent(part) }}
      </div>
      <div v-else-if="isTextPart(part)" class="message-text markdown-content">
        <VueMarkdown :source="getTextPartContent(part)" :plugins="markdownPlugins" />
      </div>
      <div
        v-else-if="shouldHideReferencePart(part)"
        class="reference-part-hidden"
        aria-hidden="true"
      ></div>
      <ChatToolPart
        v-else
        :approval-processing="approvalProcessing(part)"
        :mcp-server-label="getMcpServerLabel(part)"
        :message="message"
        :part="part"
        @approve-tool="emit('approve-tool', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai';
import VueMarkdown from 'vue-markdown-render';

import {
  isContextReportPart,
  isMemoryPart,
  isSkillUsagePart,
} from '../../../shared/chat/message_parts';
import { isObjectRecord } from '../../../shared/utils/guards';
import { isTextPart } from '../../modules/chat/ui_message_text';
import { markdownCodeBlockPlugin } from '../../utils/markdown_code_block_plugin';
import ChatToolPart from './ChatToolPart.vue';

const markdownPlugins = [markdownCodeBlockPlugin];

const props = defineProps<{
  message: UIMessage;
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
      message: UIMessage;
      part: unknown;
    }
  ): void;
}>();

const shouldHideReferencePart = (part: unknown): boolean =>
  isSkillUsagePart(part) || isMemoryPart(part) || isContextReportPart(part);

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getPartRenderKey = (part: unknown, partIndex: number): string => {
  const messageId = props.message.id || String(props.messageIndex);
  const partType = getPartType(part);
  if (isTextPart(part)) {
    return `${messageId}-${partType}-${partIndex}-${part.text.length}-${props.streamRenderTick}`;
  }
  return `${messageId}-${partType}-${partIndex}`;
};

const getTextPartContent = (part: unknown): string => {
  void props.streamRenderTick;
  return isTextPart(part) ? part.text : '';
};

const isStreamingTextPart = (part: unknown): boolean => {
  if (!isTextPart(part)) return false;
  if (!props.activeAssistantMessageId) return false;
  if (props.message.id !== props.activeAssistantMessageId) return false;
  return isObjectRecord(part) && part.state === 'streaming';
};
</script>

<style scoped>
.chat-message-parts {
  min-width: 0;
}

.reference-part-hidden {
  display: none;
}

.message-text {
  color: var(--text-primary);
  font-size: var(--font-size);
  line-height: 1.72;
  letter-spacing: 0.01em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-text.markdown-content {
  white-space: normal;
}

.chat-message-parts.user .message-text {
  color: var(--chat-user-bubble-text);
}

.message-part + .message-part {
  margin-top: 12px;
}

.message-text.markdown-content :deep(p) {
  margin: 0 0 0.9em;
}

.message-text.markdown-content :deep(h1),
.message-text.markdown-content :deep(h2),
.message-text.markdown-content :deep(h3) {
  margin: 1.2em 0 0.6em;
  line-height: 1.4;
  color: var(--text-primary);
  font-weight: 650;
}

.message-text.markdown-content :deep(h1) {
  font-size: 1.3em;
}

.message-text.markdown-content :deep(h2) {
  font-size: 1.18em;
}

.message-text.markdown-content :deep(h3) {
  font-size: 1.05em;
}

.message-text.markdown-content :deep(ul),
.message-text.markdown-content :deep(ol) {
  margin: 0.7em 0 0.95em 1.25em;
  padding: 0;
}

.message-text.markdown-content :deep(ul) {
  list-style: disc;
  list-style-position: outside;
}

.message-text.markdown-content :deep(ol) {
  list-style: decimal;
  list-style-position: outside;
}

.message-text.markdown-content :deep(li + li) {
  margin-top: 0.28em;
}

.message-text.markdown-content :deep(blockquote) {
  margin: 0.95em 0;
  padding: 0.5em 0.9em;
  border-left: 3px solid var(--accent-color);
  border-radius: 0 8px 8px 0;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.message-text.markdown-content :deep(a) {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent-color) 55%, transparent);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.message-text.markdown-content :deep(a:hover) {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}

.chat-message-parts.user .message-text.markdown-content :deep(a) {
  color: var(--chat-user-bubble-text);
  border-bottom-color: color-mix(in srgb, var(--chat-user-bubble-text) 45%, transparent);
}

.chat-message-parts.user .message-text.markdown-content :deep(a:hover) {
  color: var(--chat-user-bubble-text);
  border-bottom-color: color-mix(in srgb, var(--chat-user-bubble-text) 72%, transparent);
}

.chat-message-parts.user .message-text.markdown-content :deep(blockquote) {
  border-left-color: color-mix(in srgb, var(--chat-user-bubble-text) 55%, transparent);
  background: color-mix(in srgb, var(--chat-user-bubble-text) 8%, transparent);
  color: color-mix(in srgb, var(--chat-user-bubble-text) 90%, transparent);
}

.chat-message-parts.user .message-text.markdown-content :deep(code) {
  background: color-mix(in srgb, var(--chat-user-bubble-text) 12%, transparent);
  border-color: color-mix(in srgb, var(--chat-user-bubble-text) 18%, transparent);
  color: var(--chat-user-bubble-text);
}

.message-text.markdown-content :deep(hr) {
  margin: 1.1em 0;
  border: 0;
  border-top: 1px solid var(--border-color);
}

.message-text.markdown-content :deep(table) {
  width: 100%;
  margin: 0.9em 0;
  border-collapse: collapse;
  font-size: 0.93em;
}

.message-text.markdown-content :deep(th),
.message-text.markdown-content :deep(td) {
  padding: 0.45em 0.65em;
  border: 1px solid var(--border-color);
  text-align: left;
  vertical-align: top;
}

.message-text.markdown-content :deep(th) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 600;
}

.message-text.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text.markdown-content :deep(pre) {
  margin: 10px 0;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow-x: auto;
}

.message-text.markdown-content :deep(code) {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 1px 6px;
}

.message-text.markdown-content :deep(pre code) {
  display: block;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  font-size: 12px;
  color: var(--text-primary);
}

.message-text.markdown-content :deep(.md-code-block) {
  margin: 12px 0;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg-secondary);
}

.message-text.markdown-content :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border-color);
}

.message-text.markdown-content :deep(.md-code-lang) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  text-transform: lowercase;
}

.message-text.markdown-content :deep(.md-code-lang::before) {
  content: '⌘';
  font-size: 12px;
  color: var(--accent-color);
}

.message-text.markdown-content :deep(.md-code-copy-btn) {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.message-text.markdown-content :deep(.md-code-copy-btn:hover) {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}

.message-text.markdown-content :deep(.md-code-copy-btn[data-copied='true']) {
  color: var(--success-color, var(--accent-color));
}

.message-text.markdown-content :deep(.md-code-copy-btn svg) {
  width: 15px;
  height: 15px;
}

.message-text.markdown-content :deep(.md-code-block pre) {
  margin: 0;
  padding: 10px 14px;
  border: none;
  border-radius: 0;
  background: var(--bg-primary);
}

.message-text.markdown-content :deep(.md-code-block pre code) {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  color: var(--text-primary);
}

.message-text.markdown-content :deep(.md-code-block pre code.hljs) {
  background: transparent;
  margin: 0;
  padding: 0 !important;
}

@media (max-width: 768px) {
  .message-text {
    font-size: calc(var(--font-size) - 1px);
    line-height: 1.68;
  }
}
</style>
