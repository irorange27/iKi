<template>
  <div class="chat-message-parts" :class="message.role">
    <div
      v-for="(part, partIndex) in getRenderableParts(message.parts)"
      :key="getPartRenderKey(part, partIndex)"
      class="message-part"
    >
      <div v-if="isComposerInvocationPart(part)" class="message-invocation-tokens">
        <span
          v-for="token in getComposerInvocationTokens(part)"
          :key="token.id"
          class="message-invocation-token"
          :class="getComposerInvocationToneClass(token.kind)"
          :title="token.title || token.label"
        >
          <span v-if="token.prefix" class="message-invocation-token-prefix" aria-hidden="true">
            {{ token.prefix }}
          </span>
          <span class="message-invocation-token-label">{{ token.label }}</span>
        </span>
      </div>
      <div v-else-if="isStreamingTextPart(part)" class="message-text">
        {{ getTextPartContent(part) }}
      </div>
      <div v-else-if="isTextPart(part)" class="message-text markdown-content">
        <VueMarkdown :source="getTextPartContent(part)" :plugins="markdownPlugins" />
      </div>
      <div v-else-if="isFilePart(part) && isFileAnImage(part)" class="message-file">
        <img
          :src="part.url"
          :alt="part.filename || 'Attached image'"
          class="message-file-image"
          @click="viewerSrc = part.url"
        />
      </div>
      <ChatToolPart
        v-else
        :approval-processing="approvalProcessing(part)"
        :mcp-server-label="getMcpServerLabel(part)"
        :message="message"
        :part="part"
        @approve-tool="emit('approve-tool', $event)"
      />
    </div>
    <ImageViewerOverlay
      :visible="viewerSrc.length > 0"
      :src="viewerSrc"
      @close="viewerSrc = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import VueMarkdown from 'vue-markdown-render';

import {
  type ChatUiMessage,
  getComposerInvocationPartData,
  isComposerInvocationPart,
  isDataPart,
  isTextPart,
} from '../../../shared/chat/message_parts';
import { isObjectRecord } from '../../../shared/utils/guards';
import { markdownCodeBlockPlugin } from '../../utils/markdown_code_block_plugin';
import ChatToolPart from './ChatToolPart.vue';
import ImageViewerOverlay from '../ImageViewerOverlay.vue';

const markdownPlugins = [markdownCodeBlockPlugin];

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
}>();

const viewerSrc = ref('');

const getRenderableParts = (parts: ChatUiMessage['parts']): ChatUiMessage['parts'] =>
  parts.filter(part => isComposerInvocationPart(part) || !isDataPart(part));

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

const isFilePart = (part: unknown): part is { type: 'file'; url: string; mediaType: string; filename?: string } =>
  isObjectRecord(part) &&
  part.type === 'file' &&
  typeof part.url === 'string' &&
  typeof part.mediaType === 'string';

const isFileAnImage = (part: { type: 'file'; url: string; mediaType: string; filename?: string }): boolean =>
  part.mediaType.startsWith('image/');

const getComposerInvocationTokens = (part: unknown) =>
  getComposerInvocationPartData(part)?.tokens ?? [];

const getComposerInvocationToneClass = (kind?: string) => {
  if (kind === 'skill') return 'message-invocation-token--skill';
  if (kind === 'prompt-app') return 'message-invocation-token--prompt';
  return 'message-invocation-token--command';
};
</script>

<style scoped>
.chat-message-parts {
  min-width: 0;
}

.message-invocation-tokens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.message-invocation-token {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  max-width: min(100%, 240px);
  border: 1px solid color-mix(in srgb, var(--accent-color) 16%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
  padding: 2px 7px 2px 6px;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: 0.01em;
}

.message-invocation-token-prefix,
.message-invocation-token-label {
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

.message-invocation-token-prefix {
  flex: 0 0 auto;
  opacity: 0.82;
  font-size: 10px;
  font-weight: 500;
}

.message-invocation-token-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-invocation-token--skill {
  color: color-mix(in srgb, var(--accent-color) 88%, var(--text-primary));
  border-color: color-mix(in srgb, var(--accent-color) 20%, transparent);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.message-invocation-token--prompt {
  color: color-mix(in srgb, var(--accent-color) 74%, var(--text-primary));
  border-color: color-mix(in srgb, var(--accent-color) 16%, transparent);
  background: color-mix(in srgb, var(--accent-color) 7%, transparent);
}

.message-invocation-token--command {
  color: color-mix(in srgb, var(--warning-color) 82%, var(--text-primary));
  border-color: color-mix(in srgb, var(--warning-color) 20%, transparent);
  background: color-mix(in srgb, var(--warning-color) 9%, transparent);
}

.chat-message-parts.user .message-invocation-token {
  border-color: color-mix(in srgb, var(--chat-user-bubble-text) 18%, transparent);
  background: color-mix(in srgb, var(--chat-user-bubble-text) 10%, transparent);
}

.chat-message-parts.user .message-invocation-token--skill,
.chat-message-parts.user .message-invocation-token--prompt,
.chat-message-parts.user .message-invocation-token--command {
  color: var(--chat-user-bubble-text);
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

.message-file-image {
  max-width: 320px;
  max-height: 320px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  object-fit: contain;
  display: block;
  cursor: pointer;
}

@media (max-width: 768px) {
  .message-text {
    font-size: calc(var(--font-size) - 1px);
    line-height: 1.68;
  }

  .message-file-image {
    max-width: 240px;
    max-height: 240px;
  }
}
</style>
