<template>
  <div class="tool-call-group" :class="{ 'is-single': parts.length === 1 }">
    <button
      type="button"
      class="tool-call-group-summary"
      :aria-expanded="isOpen"
      @click="toggleGroup"
    >
      <component :is="summaryIcon" :size="14" class="tool-call-group-icon" aria-hidden="true" />
      <span class="tool-call-group-verb">{{ groupVerbLabel }}</span>
      <span class="tool-call-group-count">· {{ countLabel }}</span>
      <span v-if="totalDurationLabel" class="tool-call-group-duration">
        {{ totalDurationLabel }}
      </span>
      <ChevronDown
        :size="14"
        class="tool-call-group-chevron"
        :class="{ 'is-open': isOpen }"
        aria-hidden="true"
      />
    </button>

    <div v-if="isOpen" class="tool-call-group-rows">
      <div
        v-for="(entry, entryIndex) in parts"
        :key="getToolCallIdFromPart(entry) || entryIndex"
        class="tool-call-row"
      >
        <button
          type="button"
          class="tool-call-row-main"
          :aria-expanded="isRowOpen(entry, entryIndex)"
          @click="toggleRow(entry, entryIndex)"
        >
          <span class="tool-call-row-state" aria-hidden="true">
            <Loader2
              v-if="getToolStateKind(entry) === 'running'"
              :size="12"
              class="tool-call-row-state-icon is-running"
            />
            <CheckCircle
              v-else-if="getToolStateKind(entry) === 'success'"
              :size="12"
              class="tool-call-row-state-icon is-success"
            />
            <XCircle
              v-else-if="getToolStateKind(entry) === 'error'"
              :size="12"
              class="tool-call-row-state-icon is-error"
            />
            <CircleHelp
              v-else-if="getToolStateKind(entry) === 'pending'"
              :size="12"
              class="tool-call-row-state-icon is-pending"
            />
            <ShieldBan
              v-else-if="getToolStateKind(entry) === 'denied'"
              :size="12"
              class="tool-call-row-state-icon is-denied"
            />
          </span>
          <span class="tool-call-row-verb">{{ getToolCallVerbLabel(entry) }}</span>
          <span v-if="getToolCallTypeBadge(entry)" class="tool-call-row-badge">
            {{ getToolCallTypeBadge(entry) }}
          </span>
          <span class="tool-call-row-title">{{ getToolTitle(entry) }}</span>
          <span v-if="getToolCallPathDirectory(entry)" class="tool-call-row-path">
            {{ getToolCallPathDirectory(entry) }}
          </span>
          <span v-if="getToolDurationLabel(entry)" class="tool-call-row-duration">
            {{ getToolDurationLabel(entry) }}
          </span>
          <ChevronDown
            :size="12"
            class="tool-call-row-chevron"
            :class="{ 'is-open': isRowOpen(entry, entryIndex) }"
            aria-hidden="true"
          />
        </button>
        <div
          v-if="isRowOpen(entry, entryIndex)"
          class="tool-call-row-detail-body"
        >
          <ToolCallPart
            embedded
            :approval-processing="approvalProcessingFor(entry)"
            :mcp-server-label="getMcpServerLabel(entry)"
            :message="message"
            :part="entry"
            @approve-tool="emit('approve-tool', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  CheckCircle,
  ChevronDown,
  CircleHelp,
  Loader2,
  ShieldBan,
  XCircle,
} from 'lucide-vue-next';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

import ToolCallPart from './ToolCallPart.vue';
import {
  getToolCallGroupCountLabel,
  getToolCallGroupMeta,
  getToolCallGroupTotalDurationLabel,
  getToolCallPathDirectory,
  getToolCallTypeBadge,
  getToolCallVerbLabel,
} from '../../modules/chat/ui_message_tool_groups';
import {
  getToolCallGroupCollapsedOverride,
  setToolCallGroupCollapsed,
} from '../../modules/chat/tool_ui_state';
import {
  getToolCallIdFromPart,
  getToolDurationLabel,
  getToolIconComponent,
  getToolStateKind,
  getToolTitle,
} from '../../modules/chat/ui_message_tool_calls';
import { useI18n } from '../../i18n';

const props = defineProps<{
  groupKey: string;
  message: ChatUiMessage;
  parts: unknown[];
  approvalProcessingFor: (part: unknown) => boolean;
  getMcpServerLabel: (part: unknown) => string;
}>();

const emit = defineEmits<{
  (
    event: 'approve-tool',
    payload: { approved: boolean; message: ChatUiMessage; part: unknown }
  ): void;
}>();

const { t } = useI18n();

const meta = computed(() => getToolCallGroupMeta(props.parts));

const groupVerbLabel = computed(() =>
  t(`toolCall.group.verb.${meta.value.verb}` as Parameters<typeof t>[0])
);

const countLabel = computed(() =>
  getToolCallGroupCountLabel(meta.value.verb, props.parts.length)
);

const totalDurationLabel = computed(() =>
  getToolCallGroupTotalDurationLabel(props.parts)
);

const summaryIcon = computed(() => getToolIconComponent(props.parts[0]));

// No manual override: open while any call is running, pending approval, or
// failed (failures must stay visible), collapse back once all settle. A user
// click pins the choice (also persisted per group key so re-renders keep it).
const userOverride = ref<boolean | null>(null);
const isOpen = computed(() => {
  if (userOverride.value !== null) return userOverride.value;
  const stored = getToolCallGroupCollapsedOverride(props.groupKey);
  if (stored !== undefined) return !stored;
  return meta.value.hasActive || meta.value.hasFailed;
});

const toggleGroup = () => {
  const next = !isOpen.value;
  userOverride.value = next;
  setToolCallGroupCollapsed(props.groupKey, next);
};

// Row detail visibility: undefined falls back to auto — active calls
// (running / awaiting / failed) show their detail, settled ones stay quiet.
const rowOverrides = ref<Record<string, boolean>>({});
const rowKey = (part: unknown, index: number): string =>
  getToolCallIdFromPart(part) || `row-${index}`;

const isRowOpen = (part: unknown, index: number): boolean => {
  const override = rowOverrides.value[rowKey(part, index)];
  if (override !== undefined) return override;
  const kind = getToolStateKind(part);
  return kind === 'running' || kind === 'pending' || kind === 'error';
};

const toggleRow = (part: unknown, index: number) => {
  const key = rowKey(part, index);
  rowOverrides.value = { ...rowOverrides.value, [key]: !isRowOpen(part, index) };
};
</script>

<style scoped>
.tool-call-group {
  min-width: 0;
  max-width: 680px;
}

.tool-call-group-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  padding: 3px 8px 3px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}

.tool-call-group-summary:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tool-call-group-icon {
  flex: 0 0 auto;
  color: var(--accent-color);
}

.tool-call-group-count {
  color: var(--text-muted);
  font-weight: 400;
}

.tool-call-group-duration {
  color: var(--text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.tool-call-group-chevron {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform 0.18s ease;
  transform: rotate(-90deg);
}

.tool-call-group-chevron.is-open {
  transform: rotate(0deg);
}

/* Child rows: quiet list under the summary, joined by a soft tree line. */
.tool-call-group-rows {
  margin: 2px 0 0;
  padding-left: 6px;
  border-left: 2px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
}

.tool-call-row-main {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 3px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.tool-call-row-main:hover {
  background: var(--bg-hover);
}

.tool-call-row-state {
  display: inline-flex;
  flex: 0 0 auto;
  width: 12px;
  justify-content: center;
}

.tool-call-row-state-icon.is-running {
  color: var(--accent-color);
  animation: tool-call-row-spin 1.1s linear infinite;
}

.tool-call-row-state-icon.is-success {
  color: var(--success-color, var(--accent-color));
}

.tool-call-row-state-icon.is-error {
  color: var(--danger-color, var(--warning-color));
}

.tool-call-row-state-icon.is-pending {
  color: var(--warning-color, var(--accent-color));
}

.tool-call-row-state-icon.is-denied {
  color: var(--danger-color, var(--warning-color));
}

@keyframes tool-call-row-spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-call-row-verb {
  flex: 0 0 auto;
}

.tool-call-row-badge {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 16px;
}

.tool-call-row-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 500;
}

.tool-call-row-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--text-muted);
  font-size: 12px;
}

.tool-call-row-duration {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.tool-call-row-chevron {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0;
  transition:
    transform 0.18s ease,
    opacity 0.15s ease;
  transform: rotate(-90deg);
}

.tool-call-row-main:hover .tool-call-row-chevron,
.tool-call-row-chevron.is-open {
  opacity: 1;
}

.tool-call-row-chevron.is-open {
  transform: rotate(0deg);
}

.tool-call-row-detail-body {
  margin: 2px 0 6px 27px;
  max-width: 620px;
}
</style>
