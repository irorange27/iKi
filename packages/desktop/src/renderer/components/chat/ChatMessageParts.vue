<template>
  <div class="chat-message-parts" :class="message.role">
    <div
      v-for="segment in segments"
      :key="getSegmentRenderKey(segment)"
      class="message-part"
    >
      <ToolCallGroup
        v-if="segment.kind === 'tool-call-group'"
        :group-key="`${message.id || messageIndex}-tool-call-group-${segment.startIndex}`"
        :message="message"
        :parts="segment.parts"
        :approval-processing-for="approvalProcessing"
        :get-mcp-server-label="getMcpServerLabel"
        @approve-tool="emit('approve-tool', $event)"
      />
      <template v-else>
        <div
          v-if="isComposerInvocationPart(segment.part)"
          class="message-invocation-tokens"
        >
          <span
            v-for="token in getComposerInvocationTokens(segment.part)"
            :key="token.id"
            class="message-invocation-token"
            :class="getComposerInvocationToneClass(token.kind)"
            :title="token.title || token.label"
          >
            <span
              v-if="token.prefix"
              class="message-invocation-token-prefix"
              aria-hidden="true"
            >
              {{ token.prefix }}
            </span>
            <span class="message-invocation-token-label">{{ token.label }}</span>
          </span>
        </div>
        <div v-else-if="isStreamingTextPart(segment.part)" class="message-text">
          {{ getTextPartContent(segment.part) }}
        </div>
        <div v-else-if="isTextPart(segment.part)" class="message-text markdown-content">
          <VueMarkdown
            :source="getTextPartContent(segment.part)"
            :options="markdownOptions"
            :plugins="markdownPlugins"
          />
        </div>
        <details
          v-else-if="isReasoningPart(segment.part)"
          class="message-reasoning"
          :open="isReasoningPartExpanded(segment.part, segment.index)"
        >
          <summary
            class="message-reasoning-summary"
            @click.prevent="toggleReasoning(segment.part, segment.index)"
          >
            <ChevronDown
              class="message-reasoning-chevron"
              :class="{ 'is-open': isReasoningPartExpanded(segment.part, segment.index) }"
              aria-hidden="true"
            />
            <Brain class="message-reasoning-icon" aria-hidden="true" />
            <span class="message-reasoning-label">{{ getReasoningLabel(segment.part) }}</span>
            <span
              v-if="!isReasoningPartExpanded(segment.part, segment.index) && getReasoningPreview(segment.part)"
              class="message-reasoning-preview"
            >· {{ getReasoningPreview(segment.part) }}</span>
          </summary>
          <div class="message-reasoning-body">{{ getTextPartContent(segment.part) }}</div>
        </details>
        <div
          v-else-if="isFilePart(segment.part) && isFileAnImage(segment.part)"
          class="message-file"
        >
          <img
            :src="segment.part.url"
            :alt="segment.part.filename || 'Attached image'"
            class="message-file-image"
            @click="viewerSrc = segment.part.url"
          />
        </div>
        <ToolCallPart
          v-else
          :approval-processing="approvalProcessing(segment.part)"
          :mcp-server-label="getMcpServerLabel(segment.part)"
          :message="message"
          :part="segment.part"
          @approve-tool="emit('approve-tool', $event)"
        />
      </template>
    </div>
    <ImageViewerOverlay
      :visible="viewerSrc.length > 0"
      :src="viewerSrc"
      @close="viewerSrc = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import VueMarkdown from 'vue-markdown-render';
import { Brain, ChevronDown } from 'lucide-vue-next';

import {
  type ChatUiMessage,
  getComposerInvocationPartData,
  isComposerInvocationPart,
  isDataPart,
  isReasoningPart,
  isTextPart,
} from '@iki/backend/message/message_parts';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { markdownCodeBlockPlugin } from '../../utils/markdown_code_block_plugin';
import { segmentMessageParts, type MessagePartSegment } from '../../modules/chat/ui_message_tool_groups';
import ToolCallPart from './ToolCallPart.vue';
import ToolCallGroup from './ToolCallGroup.vue';
import ImageViewerOverlay from '../ImageViewerOverlay.vue';
import { useI18n } from '../../i18n';

const markdownPlugins = [markdownCodeBlockPlugin];
// Single newlines render as breaks (ChatGPT-style), so finalized markdown
// keeps the same line shape the streaming view showed.
const markdownOptions = { breaks: true } as const;

const { t } = useI18n();
// Per-part open state (keyed by part index): undefined falls back to the
// default — open while that part is streaming, collapsed once finished.
// Reasoning parts have stable render keys, so the <details> never remounts
// and the override survives streamed deltas.
const reasoningOpenOverrides = ref<Record<number, boolean>>({});

const isReasoningPartExpanded = (part: unknown, partIndex: number): boolean => {
  const override = reasoningOpenOverrides.value[partIndex];
  if (override !== undefined) return override;
  return isStreamingReasoningPart(part);
};

const toggleReasoning = (part: unknown, partIndex: number) => {
  reasoningOpenOverrides.value = {
    ...reasoningOpenOverrides.value,
    [partIndex]: !isReasoningPartExpanded(part, partIndex),
  };
};

const getReasoningLabel = (part: unknown): string =>
  isStreamingReasoningPart(part) ? t('chat.reasoning.thinking') : t('chat.reasoning.thought');

// Single-line collapsed preview: first non-empty line, whitespace-collapsed
// and capped; CSS ellipsis handles the rest.
const getReasoningPreview = (part: unknown): string => {
  if (!isReasoningPart(part)) return '';
  const line = getTextPartContent(part)
    .split('\n')
    .map(value => value.trim())
    .find(value => value.length > 0);
  if (!line) return '';
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
};

const props = defineProps<{
  message: ChatUiMessage;
  messageIndex: number;
  activeAssistantMessageId: string | null;
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

// Tool-call runs collapse into quiet grouped rows; everything else passes
// through with its renderable-array index (reasoning expand state keys off it).
const segments = computed<MessagePartSegment[]>(() =>
  segmentMessageParts(getRenderableParts(props.message.parts))
);

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getSegmentRenderKey = (segment: MessagePartSegment): string => {
  const messageId = props.message.id || String(props.messageIndex);
  if (segment.kind === 'tool-call-group') {
    // Group key must stay stable while the stream appends calls: key off the
    // first member only.
    return `${messageId}-tool-call-group-${segment.startIndex}`;
  }
  const part = segment.part;
  const partIndex = segment.index;
  const partType = getPartType(part);
  // Reasoning parts need a stable key: the <details> block must not remount
  // (and lose its open state) on every streamed delta.
  if (isReasoningPart(part)) {
    return `${messageId}-${partType}-${partIndex}`;
  }
  if (isTextPart(part)) {
    return `${messageId}-${partType}-${partIndex}-${part.text.length}`;
  }
  return `${messageId}-${partType}-${partIndex}`;
};

const getTextPartContent = (part: unknown): string => {
  if (isTextPart(part) || isReasoningPart(part)) return part.text;
  return '';
};

const isStreamingReasoningPart = (part: unknown): boolean => {
  if (!isReasoningPart(part)) return false;
  if (!props.activeAssistantMessageId) return false;
  if (props.message.id !== props.activeAssistantMessageId) return false;
  return isObjectRecord(part) && part.state === 'streaming';
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

.message-reasoning {
  border: none;
  background: transparent;
}

.message-reasoning-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  list-style: none;
  cursor: pointer;
  user-select: none;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
}

.message-reasoning-summary::-webkit-details-marker {
  display: none;
}

.message-reasoning-chevron {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--text-secondary);
  transition: transform 0.18s ease;
  transform: rotate(-90deg);
}

.message-reasoning-chevron.is-open {
  transform: rotate(0deg);
}

.message-reasoning-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--accent-color);
}

.message-reasoning-label {
  flex: 0 0 auto;
}

.message-reasoning-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: color-mix(in srgb, var(--text-secondary) 80%, transparent);
}

.message-reasoning-body {
  padding: 2px 0 6px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow-y: auto;
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
  font-family: var(--font-mono);
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
  margin: 10px 0;
  border: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-secondary);
}

/* Quiet code-block chrome, aligned with the reasoning row style: the language
   tag shrinks into the corner and the copy action only reveals on hover. */
.message-text.markdown-content :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px 0;
  background: transparent;
  border-bottom: none;
}

.message-text.markdown-content :deep(.md-code-lang) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  text-transform: lowercase;
}

.message-text.markdown-content :deep(.md-code-copy-btn) {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.2s ease,
    background 0.2s ease;
}

.message-text.markdown-content :deep(.md-code-block:hover) .md-code-copy-btn,
.message-text.markdown-content :deep(.md-code-copy-btn:focus-visible),
.message-text.markdown-content :deep(.md-code-copy-btn[data-copied='true']) {
  opacity: 1;
}

.message-text.markdown-content :deep(.md-code-copy-btn:hover) {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.message-text.markdown-content :deep(.md-code-copy-btn[data-copied='true']) {
  color: var(--success-color, var(--accent-color));
}

.message-text.markdown-content :deep(.md-code-copy-btn svg) {
  width: 14px;
  height: 14px;
}

.message-text.markdown-content :deep(.md-code-block pre) {
  margin: 0;
  padding: 4px 12px 10px;
  background: transparent;
  border: none;
  border-radius: 0;
  overflow-x: auto;
}

.message-text.markdown-content :deep(.md-code-block pre code) {
  font-size: 12.5px;
  line-height: 1.6;
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
