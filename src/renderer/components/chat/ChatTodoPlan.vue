<template>
  <section class="todo-plan">
    <div class="todo-plan-summary">
      <div class="todo-plan-summary-copy">
        <div class="todo-plan-eyebrow">{{ t('chat.tool.executionPlan') }}</div>
        <div class="todo-plan-progress">
          {{ t('chat.todoPlan.progress', { completed: completedCount, total: totalCount, percent }) }}
        </div>
      </div>
      <div class="todo-plan-badges">
        <span class="todo-plan-badge badge-progress">
          {{ t('chat.todoPlan.inProgressCount', { count: inProgressCount }) }}
        </span>
        <span class="todo-plan-badge badge-pending">
          {{ t('chat.todoPlan.pendingCount', { count: pendingCount }) }}
        </span>
        <span class="todo-plan-badge badge-completed">
          {{ t('chat.todoPlan.completedCount', { count: completedCount }) }}
        </span>
      </div>
    </div>

    <div class="todo-plan-rail" aria-hidden="true">
      <div class="todo-plan-rail-fill" :style="{ width: `${progressPercent}%` }"></div>
    </div>

    <div v-if="currentItem" class="todo-plan-focus">
      <div class="todo-plan-focus-label">{{ t('chat.todoPlan.current') }}</div>
      <div class="todo-plan-focus-text">{{ currentItem.text }}</div>
    </div>

    <div v-else class="todo-plan-focus is-idle">
      <div class="todo-plan-focus-label">{{ t('chat.todoPlan.current') }}</div>
      <div class="todo-plan-focus-text">{{ t('chat.todoPlan.noCurrentTask') }}</div>
    </div>

    <ol v-if="items.length > 0" class="todo-plan-list">
      <li
        v-for="item in items"
        :key="item.id"
        class="todo-plan-item"
        :class="[`status-${item.status}`]"
      >
        <span class="todo-plan-item-marker">{{ getMarker(item.status) }}</span>
        <div class="todo-plan-item-body">
          <div class="todo-plan-item-text">{{ item.text }}</div>
          <div class="todo-plan-item-meta">
            <span class="todo-plan-item-id">#{{ item.id }}</span>
            <span class="todo-plan-item-status">{{ getStatusLabel(item.status) }}</span>
          </div>
        </div>
      </li>
    </ol>

    <div v-else class="todo-plan-empty">{{ t('chat.todoPlan.empty') }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { TodoToolOutput } from '../../../shared/chat/tool_payloads';
import { useI18n } from '../../i18n';

defineOptions({
  name: 'ChatTodoPlan',
});

type TodoStatus = 'pending' | 'in_progress' | 'completed';
type TodoItem = {
  id: string;
  text: string;
  status: TodoStatus;
};

const props = defineProps<{
  output: TodoToolOutput;
}>();

const { t } = useI18n();

const isTodoStatus = (value: unknown): value is TodoStatus =>
  value === 'pending' || value === 'in_progress' || value === 'completed';

const items = computed<TodoItem[]>(() =>
  Array.isArray(props.output.items)
    ? props.output.items
        .filter(
          (item): item is { id: string; text: string; status: TodoStatus } =>
            typeof item?.id === 'string' &&
            typeof item?.text === 'string' &&
            isTodoStatus(item?.status)
        )
        .map(item => ({
          id: item.id,
          text: item.text,
          status: item.status,
        }))
    : []
);

const deriveCount = (explicit: number | undefined, status?: TodoStatus) => {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(0, Math.trunc(explicit));
  }
  if (!status) {
    return items.value.length;
  }
  return items.value.filter(item => item.status === status).length;
};

const totalCount = computed(() => deriveCount(props.output.totalCount));
const completedCount = computed(() => deriveCount(props.output.completedCount, 'completed'));
const inProgressCount = computed(() => deriveCount(props.output.inProgressCount, 'in_progress'));
const pendingCount = computed(() => deriveCount(props.output.pendingCount, 'pending'));

const progressPercent = computed(() => {
  if (totalCount.value <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completedCount.value / totalCount.value) * 100)));
});

const percent = computed(() => `${progressPercent.value}%`);
const currentItem = computed(() => items.value.find(item => item.status === 'in_progress') ?? null);

const getStatusLabel = (status: TodoStatus) => {
  if (status === 'completed') return t('chat.todoPlan.completed');
  if (status === 'in_progress') return t('chat.todoPlan.inProgress');
  return t('chat.todoPlan.pending');
};

const getMarker = (status: TodoStatus) => {
  if (status === 'completed') return '[x]';
  if (status === 'in_progress') return '[>]';
  return '[ ]';
};
</script>

<style scoped>
.todo-plan {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 14%, var(--border-color));
  border-radius: 14px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-color) 5%, var(--bg-tertiary)) 0%,
      var(--bg-tertiary) 100%
    );
  box-shadow: var(--surface-shadow-sm);
}

.todo-plan-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.todo-plan-summary-copy {
  min-width: 0;
}

.todo-plan-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.todo-plan-progress {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 650;
  color: var(--text-primary);
}

.todo-plan-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.todo-plan-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
  color: var(--text-secondary);
}

.todo-plan-badge.badge-progress {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
  color: var(--accent-color);
}

.todo-plan-badge.badge-pending {
  border-color: color-mix(in srgb, var(--warning-color) 35%, var(--border-color));
  color: color-mix(in srgb, var(--warning-color) 72%, var(--text-primary));
}

.todo-plan-badge.badge-completed {
  border-color: color-mix(in srgb, var(--success-color) 38%, var(--border-color));
  color: var(--success-color);
}

.todo-plan-rail {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 12%, var(--border-color));
}

.todo-plan-rail-fill {
  height: 100%;
  border-radius: inherit;
  background:
    linear-gradient(
      90deg,
      var(--accent-color) 0%,
      color-mix(in srgb, var(--success-color) 60%, var(--accent-color)) 100%
    );
  transition: width 0.2s ease;
}

.todo-plan-focus {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 22%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-secondary));
}

.todo-plan-focus.is-idle {
  border-color: var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}

.todo-plan-focus-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.todo-plan-focus-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}

.todo-plan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.todo-plan-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
}

.todo-plan-item.status-in_progress {
  border-color: color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-secondary));
}

.todo-plan-item.status-completed {
  border-color: color-mix(in srgb, var(--success-color) 28%, var(--border-color));
}

.todo-plan-item-marker {
  flex: 0 0 auto;
  min-width: 28px;
  padding-top: 1px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.todo-plan-item.status-in_progress .todo-plan-item-marker {
  color: var(--accent-color);
}

.todo-plan-item.status-completed .todo-plan-item-marker {
  color: var(--success-color);
}

.todo-plan-item-body {
  min-width: 0;
  flex: 1 1 auto;
}

.todo-plan-item-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.todo-plan-item.status-completed .todo-plan-item-text {
  color: var(--text-secondary);
}

.todo-plan-item-meta {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}

.todo-plan-item-id,
.todo-plan-item-status {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.todo-plan-empty {
  padding: 12px;
  border-radius: 12px;
  border: 1px dashed var(--border-color);
  color: var(--text-secondary);
  font-size: 13px;
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}
</style>
