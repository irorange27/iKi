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
        <template v-else-if="isStreamingTextPart(segment.part) || isTextPart(segment.part)">
          <div
            v-if="isStreamingTextPart(segment.part)"
            class="message-text"
            :class="{ 'is-text-collapsed': isUserTextClamped }"
          >
            {{ getTextPartContent(segment.part) }}
          </div>
          <div
            v-else
            class="message-text markdown-content"
            :class="{ 'is-text-collapsed': isUserTextClamped }"
          >
            <VueMarkdown
              :source="getTextPartContent(segment.part)"
              :options="markdownOptions"
              :plugins="markdownPlugins"
            />
          </div>
          <button
            v-if="isUserTextCollapsible"
            class="user-text-toggle"
            type="button"
            :aria-expanded="userTextExpanded"
            @click="toggleUserTextExpanded"
          >
            <span>{{ userTextToggleLabel }}</span>
            <ChevronDown
              class="user-text-toggle-chevron"
              :class="{ 'is-open': userTextExpanded }"
              aria-hidden="true"
            />
          </button>
        </template>
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
              v-if="
                !isReasoningPartExpanded(segment.part, segment.index) &&
                reasoningPreviews.get(segment.index)
              "
              class="message-reasoning-preview"
              >· {{ reasoningPreviews.get(segment.index) }}</span
            >
          </summary>
          <div class="message-reasoning-body">{{ getTextPartContent(segment.part) }}</div>
        </details>
        <div
          v-else-if="isFilePart(segment.part) && isFileAnImage(segment.part)"
          class="message-file"
        >
          <button
            type="button"
            class="message-file-open"
            :aria-label="t('a11y.viewImage')"
            @click="viewerSrc = segment.part.url"
          >
            <img
              :src="segment.part.url"
              :alt="segment.part.filename || 'Attached image'"
              class="message-file-image"
            />
          </button>
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
import { isObjectRecord } from '@iki/core/utils/guards';
import { markdownCodeBlockPlugin } from '../../utils/markdown_code_block_plugin';
import { markdownMathPlugin } from '../../utils/markdown_math_plugin';
import {
  segmentMessageParts,
  type MessagePartSegment,
} from '../../modules/chat/ui_message_tool_groups';
import ToolCallPart from './ToolCallPart.vue';
import ToolCallGroup from './ToolCallGroup.vue';
import ImageViewerOverlay from '../ImageViewerOverlay.vue';
import { useI18n } from '../../i18n';

const markdownPlugins = [markdownMathPlugin, markdownCodeBlockPlugin];
const markdownOptions = { breaks: true } as const;

const { t } = useI18n();
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
  'approve-tool': [payload: {
      approved: boolean;
      message: ChatUiMessage;
      part: unknown;
    },
  ];
}>();

const viewerSrc = ref('');

const getRenderableParts = (parts: ChatUiMessage['parts']): ChatUiMessage['parts'] =>
  parts.filter(part => isComposerInvocationPart(part) || !isDataPart(part));

const segments = computed<MessagePartSegment[]>(() =>
  segmentMessageParts(getRenderableParts(props.message.parts))
);

const reasoningPreviews = computed(() => {
  const previews = new Map<number, string>();
  for (const segment of segments.value) {
    if (segment.kind !== 'tool-call-group' && isReasoningPart(segment.part) &&
        !isReasoningPartExpanded(segment.part, segment.index)) {
      previews.set(segment.index, getReasoningPreview(segment.part));
    }
  }
  return previews;
});

const USER_TEXT_COLLAPSE_LINES = 5;

const userTextExpanded = ref(false);

const isUserMessage = computed(() => props.message.role === 'user');

const countTextLines = (text: string): number => {
  if (!text.trim()) return 0;
  return text.replace(/\s+$/, '').split('\n').length;
};

const isUserTextCollapsible = computed(() => {
  if (!isUserMessage.value) return false;
  const totalLines = props.message.parts.reduce(
    (total, part) => (isTextPart(part) ? total + countTextLines(getTextPartContent(part)) : total),
    0
  );
  return totalLines > USER_TEXT_COLLAPSE_LINES;
});

const isUserTextClamped = computed(
  () => isUserMessage.value && isUserTextCollapsible.value && !userTextExpanded.value
);

const toggleUserTextExpanded = () => {
  userTextExpanded.value = !userTextExpanded.value;
};

const userTextToggleLabel = computed(() =>
  t(userTextExpanded.value ? 'chat.userText.collapse' : 'chat.userText.expand')
);

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getSegmentRenderKey = (segment: MessagePartSegment): string => {
  const messageId = props.message.id || String(props.messageIndex);
  if (segment.kind === 'tool-call-group') {
    return `${messageId}-tool-call-group-${segment.startIndex}`;
  }
  return `${messageId}-${getPartType(segment.part)}-${segment.index}`;
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

const isFileAnImage = (part: {
  type: 'file';
  url: string;
  mediaType: string;
  filename?: string;
}): boolean => part.mediaType.startsWith('image/');

const getComposerInvocationTokens = (part: unknown) =>
  getComposerInvocationPartData(part)?.tokens ?? [];

const getComposerInvocationToneClass = (kind?: string) => {
  if (kind === 'skill') return 'message-invocation-token--skill';
  if (kind === 'prompt-app') return 'message-invocation-token--prompt';
  return 'message-invocation-token--command';
};
</script>

<style scoped src="./chat_message_parts.css"></style>
