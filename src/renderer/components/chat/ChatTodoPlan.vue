<template>
  <section
    class="todo-plan"
    :class="{ 'is-collapsed': isCollapsed }"
    :aria-label="t('chat.tool.executionPlan')"
  >
    <div class="todo-plan-summary">
      <div class="todo-plan-summary-main">
        <ListTodo :size="14" class="todo-plan-summary-icon" />
        <div class="todo-plan-progress">
          {{ t('chat.todoPlan.progress', { completed: completedCount, total: totalCount }) }}
        </div>
      </div>
      <button
        type="button"
        class="todo-plan-toggle"
        :aria-expanded="isCollapsed ? 'false' : 'true'"
        :aria-label="isCollapsed ? t('chat.tool.expandDetails') : t('chat.tool.collapseDetails')"
        @click="isCollapsed = !isCollapsed"
      >
        <ChevronDown :size="14" class="todo-plan-toggle-icon" :class="{ 'is-collapsed': isCollapsed }" />
      </button>
    </div>

    <ol v-if="!isCollapsed && visibleItems.length > 0" class="todo-plan-list">
      <li
        v-for="(item, index) in visibleItems"
        :key="item.id"
        class="todo-plan-item"
        :class="[`status-${item.status}`]"
      >
        <span class="todo-plan-item-marker" aria-hidden="true"></span>
        <span class="todo-plan-item-index">{{ index + 1 }}.</span>
        <div class="todo-plan-item-body">
          <div class="todo-plan-item-text">{{ item.text }}</div>
          <div v-if="item.status === 'in_progress'" class="todo-plan-item-hint">
            {{ t('chat.todoPlan.inProgress') }}
          </div>
        </div>
      </li>
    </ol>

    <div v-else-if="!isCollapsed" class="todo-plan-empty">{{ t('chat.todoPlan.empty') }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDown, ListTodo } from 'lucide-vue-next';

import {
  MAX_EXECUTION_TASK_PLAN_ITEMS,
  type TaskPlan,
  type TaskPlanItemStatus,
} from '../../../shared/types/task_plan';
import { useI18n } from '../../i18n';

defineOptions({
  name: 'ChatTodoPlan',
});

const props = defineProps<{
  plan: Pick<TaskPlan, 'thread_id' | 'items'>;
}>();

const { t } = useI18n();
const isCollapsed = ref(false);

const items = computed(() =>
  Array.isArray(props.plan.items) ? props.plan.items : []
);
const visibleItems = computed(() => items.value.slice(0, MAX_EXECUTION_TASK_PLAN_ITEMS));

const deriveCount = (status?: TaskPlanItemStatus) => {
  if (!status) return items.value.length;
  return items.value.filter(item => item.status === status).length;
};

const totalCount = computed(() => deriveCount());
const completedCount = computed(() => deriveCount('completed'));

watch(
  () => props.plan.thread_id,
  () => {
    isCollapsed.value = false;
  }
);
</script>

<style scoped>
.todo-plan {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary));
}

.todo-plan.is-collapsed {
  gap: 0;
}

.todo-plan-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.todo-plan-summary-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.todo-plan-summary-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0.9;
}

.todo-plan-progress {
  font-size: 13px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--text-primary);
}

.todo-plan-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.todo-plan-toggle:hover {
  background: var(--bg-hover);
  border-color: var(--border-color);
  color: var(--text-primary);
}

.todo-plan-toggle-icon {
  transition: transform 0.18s ease;
}

.todo-plan-toggle-icon.is-collapsed {
  transform: rotate(-90deg);
}

.todo-plan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.todo-plan-item {
  display: grid;
  grid-template-columns: 14px auto minmax(0, 1fr);
  align-items: flex-start;
  column-gap: 8px;
  padding: 0;
}

.todo-plan-item-marker {
  position: relative;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--text-muted) 70%, var(--border-color));
  box-sizing: border-box;
}

.todo-plan-item.status-in_progress .todo-plan-item-marker {
  border-color: color-mix(in srgb, var(--accent-color) 70%, var(--border-color));
}

.todo-plan-item.status-in_progress .todo-plan-item-marker::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: inherit;
  background: var(--accent-color);
}

.todo-plan-item.status-completed .todo-plan-item-marker {
  border-color: color-mix(in srgb, var(--success-color) 80%, var(--border-color));
  background: color-mix(in srgb, var(--success-color) 88%, transparent);
}

.todo-plan-item.status-completed .todo-plan-item-marker::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 3px;
  height: 6px;
  border-right: 1.5px solid var(--bg-primary);
  border-bottom: 1.5px solid var(--bg-primary);
  transform: rotate(40deg);
}

.todo-plan-item-index {
  min-width: 1.6em;
  font-size: 13px;
  line-height: 1.35;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.todo-plan-item-body {
  min-width: 0;
}

.todo-plan-item-text {
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.todo-plan-item.status-in_progress .todo-plan-item-text {
  font-weight: 600;
}

.todo-plan-item.status-completed .todo-plan-item-text {
  color: var(--text-secondary);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-muted) 55%, transparent);
}

.todo-plan-item-hint {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  font-weight: 500;
  color: var(--accent-color);
}

.todo-plan-empty {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-muted);
  padding-left: 22px;
}
</style>
