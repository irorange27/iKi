<template>
  <template v-if="isHiddenTodoTool"></template>

  <div v-else-if="isApprovalRequestedPart(part)" class="tool-approval-content">
    <div class="tool-approval-header">
      <svg class="tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      <span class="tool-approval-title">{{ t('chat.tool.approvalRequest') }}</span>
    </div>
    <div class="tool-approval-body">
      <div class="tool-name">
        {{ getToolName(part) }}
      </div>
      <div class="tool-args">
        <pre>{{ formatJson(getToolInput(part)) }}</pre>
      </div>
    </div>
    <div class="tool-approval-actions">
      <button class="approve-btn" :disabled="approvalProcessing" @click="emitApproval(true)">
        {{ t('chat.tool.approve') }}
      </button>
      <button class="reject-btn" :disabled="approvalProcessing" @click="emitApproval(false)">
        {{ t('chat.tool.reject') }}
      </button>
    </div>
  </div>

  <div
    v-else-if="isToolResultPart(part)"
    class="tool-result-content"
    :class="{ 'tool-card-collapsed': isToolCollapsed(part) }"
  >
    <div class="tool-card-header">
      <span class="tool-card-tag tag-result">{{ t('chat.tool.resultTag') }}</span>
      <div class="tool-card-lead">
        <component :is="getToolIconComponent(part)" :size="16" class="tool-card-lead-icon" />
        <span class="tool-card-title">{{ getToolTitle(part) }}</span>
        <span class="tool-card-tool">{{ getToolName(part) }}</span>
        <span v-if="mcpServerLabel" class="tool-card-server">
          {{ t('chat.tool.mcpServer', { name: mcpServerLabel }) }}
        </span>
      </div>
      <div class="tool-card-meta">
        <span
          v-if="getToolStateLabel(part)"
          class="tool-state-pill"
          :class="getToolStatePillClass(part)"
        >
          <CheckCircle
            v-if="getToolStateKind(part) === 'success'"
            :size="14"
            class="tool-state-icon"
          />
          <XCircle
            v-else-if="getToolStateKind(part) === 'error'"
            :size="14"
            class="tool-state-icon"
          />
          <ShieldBan
            v-else-if="getToolStateKind(part) === 'denied'"
            :size="14"
            class="tool-state-icon"
          />
          <CircleHelp
            v-else-if="getToolStateKind(part) === 'pending'"
            :size="14"
            class="tool-state-icon"
          />
          <Loader2
            v-else-if="getToolStateKind(part) === 'running'"
            :size="14"
            class="tool-state-icon tool-icon-spin"
          />
          <span>{{ getToolStateLabel(part) }}</span>
        </span>
        <span v-if="getToolDurationLabel(part)" class="tool-duration">
          <Clock :size="14" class="tool-duration-icon" />
          <span>{{ getToolDurationLabel(part) }}</span>
        </span>
        <button
          v-if="canToggleToolCollapse(part)"
          type="button"
          class="tool-collapse-btn"
          :aria-label="
            isToolCollapsed(part) ? t('chat.tool.expandDetails') : t('chat.tool.collapseDetails')
          "
          @click.stop="toggleToolCollapse(message, part)"
        >
          <ChevronDown
            :size="16"
            class="tool-collapse-icon"
            :class="{ 'is-expanded': !isToolCollapsed(part) }"
          />
        </button>
      </div>
    </div>
    <div v-if="!isToolCollapsed(part)">
      <div v-if="hasWebSearchCitations(part)" class="tool-card-section">
        <div class="tool-card-section-title">{{ t('chat.tool.references') }}</div>
        <ol class="tool-citations">
          <li
            v-for="citation in getWebSearchCitations(part)"
            :key="citation.url"
            class="tool-citation"
          >
            <a :href="citation.url" target="_blank" rel="noopener noreferrer">
              {{ citation.title }}
            </a>
            <span v-if="citation.domain" class="tool-citation-domain">{{ citation.domain }}</span>
          </li>
        </ol>
      </div>
      <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
        <div class="tool-card-section-title">
          {{ getToolInputDisplayTitle(part) }}
        </div>
        <pre class="tool-json-output">{{ formatJson(getToolInputDisplayValue(part)) }}</pre>
        <div v-if="getToolInputDisplayMetaText(part)" class="tool-input-meta">
          {{ getToolInputDisplayMetaText(part) }}
        </div>
      </div>
      <div v-if="hasDisplayValue(getToolOutput(part))" class="tool-card-section">
        <div class="tool-card-section-title">{{ t('chat.tool.output') }}</div>
        <pre class="tool-json-output">{{ formatJson(getToolOutput(part)) }}</pre>
      </div>
    </div>
    <div v-if="getToolCallIdFromPart(part) && !isToolCollapsed(part)" class="tool-card-footer">
      <span class="tool-call-id">
        {{ t('chat.tool.callId') }}:
        <span class="tool-call-id-value">{{ getToolCallIdFromPart(part) }}</span>
      </span>
    </div>
  </div>

  <div
    v-else-if="isToolCallPart(part)"
    class="tool-call-content"
    :class="{ 'tool-card-collapsed': isToolCollapsed(part) }"
  >
    <div class="tool-card-header">
      <span class="tool-card-tag tag-call">{{ t('chat.tool.callTag') }}</span>
      <div class="tool-card-lead">
        <component :is="getToolIconComponent(part)" :size="16" class="tool-card-lead-icon" />
        <span class="tool-card-title">{{ getToolTitle(part) }}</span>
        <span class="tool-card-tool">{{ getToolName(part) }}</span>
        <span v-if="mcpServerLabel" class="tool-card-server">
          {{ t('chat.tool.mcpServer', { name: mcpServerLabel }) }}
        </span>
      </div>
      <div class="tool-card-meta">
        <span
          v-if="getToolStateLabel(part)"
          class="tool-state-pill"
          :class="getToolStatePillClass(part)"
        >
          <CheckCircle
            v-if="getToolStateKind(part) === 'success'"
            :size="14"
            class="tool-state-icon"
          />
          <XCircle
            v-else-if="getToolStateKind(part) === 'error'"
            :size="14"
            class="tool-state-icon"
          />
          <ShieldBan
            v-else-if="getToolStateKind(part) === 'denied'"
            :size="14"
            class="tool-state-icon"
          />
          <CircleHelp
            v-else-if="getToolStateKind(part) === 'pending'"
            :size="14"
            class="tool-state-icon"
          />
          <Loader2
            v-else-if="getToolStateKind(part) === 'running'"
            :size="14"
            class="tool-state-icon tool-icon-spin"
          />
          <span>{{ getToolStateLabel(part) }}</span>
        </span>
        <span v-if="getToolDurationLabel(part)" class="tool-duration">
          <Clock :size="14" class="tool-duration-icon" />
          <span>{{ getToolDurationLabel(part) }}</span>
        </span>
        <button
          v-if="canToggleToolCollapse(part)"
          type="button"
          class="tool-collapse-btn"
          :aria-label="
            isToolCollapsed(part) ? t('chat.tool.expandDetails') : t('chat.tool.collapseDetails')
          "
          @click.stop="toggleToolCollapse(message, part)"
        >
          <ChevronDown
            :size="16"
            class="tool-collapse-icon"
            :class="{ 'is-expanded': !isToolCollapsed(part) }"
          />
        </button>
      </div>
    </div>
    <div v-if="!isToolCollapsed(part)">
      <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
        <div class="tool-card-section-title">{{ t('chat.tool.arguments') }}</div>
        <pre class="tool-json-output">{{ formatJson(getToolInput(part)) }}</pre>
      </div>
    </div>
    <div v-if="getToolCallIdFromPart(part) && !isToolCollapsed(part)" class="tool-card-footer">
      <span class="tool-call-id">
        {{ t('chat.tool.callId') }}:
        <span class="tool-call-id-value">{{ getToolCallIdFromPart(part) }}</span>
      </span>
    </div>
  </div>

  <div v-else class="tool-fallback-content">
    <pre class="tool-json-output">{{ formatJson(part) }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  CheckCircle,
  ChevronDown,
  CircleHelp,
  Clock,
  Loader2,
  ShieldBan,
  XCircle,
} from 'lucide-vue-next';
import type { ChatUiMessage } from '../../../shared/chat/message_parts';

import {
  canToggleToolCollapse,
  formatJson,
  getToolCallIdFromPart,
  getToolDurationLabel,
  getToolIconComponent,
  getToolInput,
  getToolInputDisplayMetaText,
  getToolInputDisplayTitle,
  getToolInputDisplayValue,
  getToolName,
  getToolOutput,
  getToolStateKind,
  getToolStateLabel,
  getToolStatePillClass,
  getToolTitle,
  getWebSearchCitations,
  hasDisplayValue,
  hasWebSearchCitations,
  isApprovalRequestedPart,
  isTranscriptHiddenToolPart,
  isToolCallPart,
  isToolCollapsed,
  isToolResultPart,
  toggleToolCollapse,
} from '../../modules/chat/ui_message_tool_parts';
import { useI18n } from '../../i18n';

const props = defineProps<{
  approvalProcessing: boolean;
  mcpServerLabel: string;
  message: ChatUiMessage;
  part: unknown;
}>();

const emit = defineEmits<{
  (
    event: 'approve-tool',
    payload: { approved: boolean; message: ChatUiMessage; part: unknown }
  ): void;
}>();

const { t } = useI18n();

const isHiddenTodoTool = computed(() => isTranscriptHiddenToolPart(props.part));

const emitApproval = (approved: boolean) => {
  emit('approve-tool', {
    approved,
    message: props.message,
    part: props.part,
  });
};
</script>
<style scoped src="./chat_tool_part.css"></style>
