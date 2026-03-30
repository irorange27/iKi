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

<style scoped>
.tool-approval-content,
.tool-call-content,
.tool-result-content,
.tool-fallback-content {
  width: 100%;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-sizing: border-box;
  padding: 14px;
  max-width: 680px;
  min-width: 0;
}

.tool-card-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.tool-card-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 999px;
  padding: 2px 8px;
}

.tag-call {
  color: var(--accent-color);
  background: var(--bg-tertiary);
}

.tag-result {
  color: var(--success-color, var(--accent-color));
  background: var(--bg-tertiary);
}

.tool-card-lead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1 1 auto;
}

.tool-card-lead-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.tool-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-card-tool {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 2px 8px;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.tool-card-server {
  flex-basis: 100%;
  font-size: 11px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.tool-card-meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}

.tool-state-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.tool-state-pill.tool-state-success {
  color: var(--success-color, var(--accent-color));
  border-color: color-mix(
    in srgb,
    var(--success-color, var(--accent-color)) 55%,
    var(--border-color)
  );
  background: color-mix(in srgb, var(--success-color, var(--accent-color)) 12%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-error {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 10%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-denied {
  color: var(--text-muted);
  border-color: color-mix(in srgb, var(--text-muted) 55%, var(--border-color));
  background: color-mix(in srgb, var(--text-muted) 10%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-pending,
.tool-state-pill.tool-state-running {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-tertiary));
}

.tool-state-icon {
  opacity: 0.95;
}

.tool-icon-spin {
  animation: tool-spin 0.9s linear infinite;
}

@keyframes tool-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.tool-duration {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.9;
}

.tool-duration-icon {
  opacity: 0.85;
}

.tool-input-meta {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.tool-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.tool-collapse-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-color);
  color: var(--text-primary);
}

.tool-collapse-icon {
  transition: transform 0.18s ease;
}

.tool-collapse-icon.is-expanded {
  transform: rotate(180deg);
}

.tool-card-collapsed .tool-card-header {
  margin-bottom: 0;
}

.tool-card-section + .tool-card-section {
  margin-top: 10px;
}

.tool-card-footer {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}

.tool-call-id {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tool-call-id-value {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.tool-card-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tool-citations {
  margin: 0;
  padding-left: 18px;
  color: var(--text-primary);
  display: grid;
  gap: 6px;
}

.tool-citation {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}

.tool-citation a {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent-color) 55%, transparent);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.tool-citation a:hover {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}

.tool-citation-domain {
  margin-left: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.tool-json-output {
  margin: 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.tool-approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.tool-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-color);
}

.tool-approval-title {
  font-size: 14px;
}

.tool-approval-body {
  margin-bottom: 12px;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.tool-args {
  margin: 0;
}

.tool-args pre {
  margin: 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  overflow-x: auto;
  white-space: pre;
}

.tool-approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.approve-btn,
.reject-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.approve-btn {
  background: var(--accent-color);
  color: white;
}

.approve-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.reject-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.reject-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.approve-btn:disabled,
.reject-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
