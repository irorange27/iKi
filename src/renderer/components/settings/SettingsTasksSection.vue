<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="card-title">Proactive Tasks</div>
      <p class="card-help">
        Create scheduled tasks that run in the background and push results into a chat thread.
      </p>

      <label class="input-label">
        <span>Name</span>
        <input v-model="taskForm.name" type="text" placeholder="Daily briefing" />
      </label>

      <label class="input-label">
        <span>Prompt</span>
        <textarea v-model="taskForm.prompt" placeholder="What should this task do?" />
      </label>

      <label class="input-label">
        <span>Schedule Type</span>
        <SettingsSelect
          :model-value="taskForm.schedule_type"
          :options="taskScheduleTypeOptions"
          aria-label="Task schedule type"
          @update:model-value="updateTaskScheduleTypeSelection"
        />
      </label>

      <div class="task-form-grid">
        <label class="input-label">
          <span>{{
            taskForm.schedule_type === 'cron' ? 'Cron Expression' : 'Every (minutes)'
          }}</span>
          <input
            v-if="taskForm.schedule_type === 'interval'"
            v-model.number="taskForm.interval_minutes"
            type="number"
            min="1"
            max="10080"
          />
          <input v-else v-model="taskForm.cron_expression" type="text" placeholder="*/15 * * * *" />
          <div v-if="taskForm.schedule_type === 'cron'" class="input-hint">
            5-field cron (min hour day month weekday). Example: 0 9 * * 1-5
          </div>
        </label>

        <label class="input-label">
          <span>Provider</span>
          <SettingsSelect
            :model-value="taskForm.provider_type"
            :options="taskProviderOptions"
            :disabled="taskProviderOptions.length === 0"
            placeholder="Select a provider"
            empty-text="No providers available."
            aria-label="Task provider"
            @update:model-value="updateTaskProviderSelection"
          />
        </label>
      </div>

      <label v-if="taskForm.schedule_type === 'cron'" class="input-label">
        <span>Time Zone (optional)</span>
        <input
          v-model="taskForm.schedule_timezone"
          type="text"
          placeholder="Auto (local time zone)"
        />
      </label>

      <label class="input-label">
        <span>Model</span>
        <SettingsSelect
          :model-value="taskForm.model"
          :options="taskModelOptions"
          :disabled="taskModelOptions.length === 0"
          placeholder="Select a model"
          empty-text="No models available."
          aria-label="Task model"
          @update:model-value="updateTaskModelSelection"
        />
      </label>

      <label class="input-label">
        <span>Push To Thread</span>
        <SettingsSelect
          :model-value="taskForm.thread_id"
          :options="taskThreadOptions"
          aria-label="Push task output to thread"
          @update:model-value="updateTaskThreadSelection"
        />
      </label>

      <label class="input-label">
        <span>Tool Strategy</span>
        <SettingsSelect
          :model-value="taskForm.tool_mode"
          :options="taskToolModeOptions"
          aria-label="Task tool strategy"
          @update:model-value="updateTaskToolModeSelection"
        />
        <div class="input-hint">
          Auto lets the task agent decide when to use safe built-in tools for freshness.
        </div>
      </label>

      <div v-if="taskForm.tool_mode === 'manual'" class="task-tools">
        <div class="task-tools-title">Allowed Tools (safe)</div>
        <div class="task-tools-grid">
          <label v-for="tool in SAFE_TASK_TOOLS" :key="tool" class="checkbox-label">
            <input
              type="checkbox"
              :checked="taskForm.tools.includes(tool)"
              @change="toggleTaskTool(tool, ($event.target as HTMLInputElement).checked)"
            />
            {{ tool }}
          </label>
        </div>
      </div>
      <p v-else class="input-hint">
        {{
          taskForm.tool_mode === 'disabled'
            ? 'This task will run without any tools.'
            : 'This task may autonomously use safe built-in tools when current information matters.'
        }}
      </p>

      <label class="checkbox-label">
        <input type="checkbox" v-model="taskForm.enabled" />
        Enabled
      </label>

      <label class="checkbox-label">
        <input type="checkbox" v-model="taskForm.notify" />
        Desktop notification
      </label>

      <div class="task-form-actions">
        <button class="secondary-btn" @click="createProactiveTask" :disabled="taskCreateLoading">
          {{ taskCreateLoading ? 'Creating...' : 'Create Task' }}
        </button>
        <button class="secondary-btn" @click="refreshTasks" :disabled="tasksLoading">
          Refresh
        </button>
      </div>

      <p v-if="taskCreateError" class="tasks-error">{{ taskCreateError }}</p>
      <p v-if="tasksError" class="tasks-error">{{ tasksError }}</p>
    </div>

    <div class="settings-card">
      <div class="card-title">Existing Tasks</div>

      <div v-if="tasksLoading" class="tasks-empty">Loading...</div>
      <div v-else-if="proactiveTasks.length === 0" class="tasks-empty">No tasks yet.</div>
      <div v-else class="tasks-list">
        <div v-for="task in proactiveTasks" :key="task.id" class="task-item">
          <div class="task-item-header">
            <div class="task-item-title">
              <span class="task-name">{{ task.name }}</span>
              <span class="task-status" :class="`status-${task.last_status || 'idle'}`">
                {{ task.last_status || 'idle' }}
              </span>
            </div>
            <div class="task-item-actions">
              <button
                class="skills-mini-btn"
                @click="runTaskNow(task)"
                :disabled="!!taskRunLoading[task.id]"
              >
                {{ taskRunLoading[task.id] ? 'Running...' : 'Run now' }}
              </button>
              <button class="skills-mini-btn" @click="deleteTask(task)">Delete</button>
            </div>
          </div>

          <div class="task-item-meta">
            <label class="checkbox-label task-compact-check">
              <input
                type="checkbox"
                :checked="task.enabled"
                @change="toggleTaskEnabled(task, ($event.target as HTMLInputElement).checked)"
              />
              Enabled
            </label>
            <label class="checkbox-label task-compact-check">
              <input
                type="checkbox"
                :checked="task.notify"
                @change="toggleTaskNotify(task, ($event.target as HTMLInputElement).checked)"
              />
              Notify
            </label>
            <template v-if="task.schedule_type === 'cron'">
              <label class="input-label task-inline-field task-cron-field">
                <span>Cron</span>
                <input
                  type="text"
                  :value="task.cron_expression || ''"
                  placeholder="*/15 * * * *"
                  @change="updateTaskCron(task, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label class="input-label task-inline-field task-timezone-field">
                <span>TZ</span>
                <input
                  type="text"
                  :value="task.schedule_timezone || ''"
                  placeholder="Local"
                  @change="updateTaskTimezone(task, ($event.target as HTMLInputElement).value)"
                />
              </label>
            </template>
            <label v-else class="input-label task-inline-field">
              <span>Every (min)</span>
              <input
                type="number"
                min="1"
                max="10080"
                :value="task.interval_minutes"
                @change="updateTaskInterval(task, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <div class="task-item-schedule">
            <span class="task-meta-label">Schedule:</span>
            {{ formatTaskSchedule(task) }}
          </div>

          <div class="task-item-schedule">
            <span class="task-meta-label">Tool Strategy:</span>
            {{ formatTaskToolStrategy(task) }}
          </div>

          <div class="task-item-times">
            <div>
              <span class="task-meta-label">Next:</span>
              {{ task.next_run_at ? formatTimestamp(task.next_run_at) : '-' }}
            </div>
            <div>
              <span class="task-meta-label">Last:</span>
              {{ task.last_run_at ? formatTimestamp(task.last_run_at) : '-' }}
            </div>
          </div>

          <div v-if="task.last_error" class="tasks-error task-error-block">
            {{ task.last_error }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue';

import SettingsSelect from './SettingsSelect.vue';
import type { ChatThread } from '../../../shared/types/chat';
import type {
  ProactiveTask,
  ProactiveTaskToolMode,
  SafeProactiveTaskTool,
} from '../../../shared/types/tasks';
import {
  SAFE_PROACTIVE_TASK_TOOLS,
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  parseProactiveTaskTools,
} from '../../../shared/types/tasks';
import { getErrorMessage } from '../../../shared/utils/errors';
import { formatTimestamp } from './settings_formatters';

type ProviderModels = {
  id: string;
  name: string;
  type: string;
  models: string[];
};

const props = defineProps<{
  active: boolean;
  providers: ProviderModels[];
}>();
const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;

const proactiveTasks = ref<ProactiveTask[]>([]);
const tasksLoading = ref(false);
const tasksError = ref('');
const taskCreateLoading = ref(false);
const taskCreateError = ref('');
const taskRunLoading = ref<Record<string, boolean>>({});
const taskThreads = ref<ChatThread[]>([]);

const SAFE_TASK_TOOLS = SAFE_PROACTIVE_TASK_TOOLS;
const taskScheduleTypeOptions = [
  { value: 'interval', label: 'Interval (minutes)' },
  { value: 'cron', label: 'Cron expression' },
];
const taskToolModeOptions = [
  { value: 'auto', label: 'Auto (agent decides)' },
  { value: 'manual', label: 'Manual safe allowlist' },
  { value: 'disabled', label: 'Disabled' },
];

const isTaskPushPayload = (payload: unknown): payload is { type?: string } =>
  typeof payload === 'object' && payload !== null && 'type' in payload;

const taskForm = ref<{
  name: string;
  prompt: string;
  schedule_type: 'interval' | 'cron';
  interval_minutes: number;
  cron_expression: string;
  schedule_timezone: string;
  enabled: boolean;
  notify: boolean;
  provider_type: string;
  model: string;
  thread_id: string;
  tool_mode: ProactiveTaskToolMode;
  tools: SafeProactiveTaskTool[];
}>({
  name: '',
  prompt: '',
  schedule_type: 'interval',
  interval_minutes: 60,
  cron_expression: '',
  schedule_timezone: '',
  enabled: true,
  notify: true,
  provider_type: '',
  model: '',
  thread_id: '',
  tool_mode: 'auto',
  tools: ['web', 'fetch'],
});

const uniqueProviderTypes = computed(() => {
  const seen = new Set<string>();
  return props.providers
    .filter(provider => {
      if (!provider.type) return false;
      if (seen.has(provider.type)) return false;
      seen.add(provider.type);
      return true;
    })
    .map(provider => ({
      type: provider.type,
      name: `${provider.name} (${provider.type})`,
      models: provider.models,
    }));
});

const taskProviderOptions = computed(() =>
  uniqueProviderTypes.value.map(provider => ({
    value: provider.type,
    label: provider.name,
  }))
);

const taskAvailableModels = computed(() => {
  const type = taskForm.value.provider_type;
  if (!type) return [];
  const provider = props.providers.find(candidate => candidate.type === type);
  return provider?.models || [];
});

const taskModelOptions = computed(() =>
  taskAvailableModels.value.map(model => ({
    value: model,
    label: model,
  }))
);

const taskThreadOptions = computed(() => [
  { value: '', label: 'Auto-create dedicated thread' },
  ...taskThreads.value.map(thread => ({
    value: thread.id,
    label: thread.title || thread.id,
  })),
]);

const updateTaskScheduleTypeSelection = (value: string) => {
  taskForm.value.schedule_type = value as 'interval' | 'cron';
};

const updateTaskProviderSelection = (value: string) => {
  taskForm.value.provider_type = value;
};

const updateTaskModelSelection = (value: string) => {
  taskForm.value.model = value;
};

const updateTaskThreadSelection = (value: string) => {
  taskForm.value.thread_id = value;
};

const updateTaskToolModeSelection = (value: string) => {
  taskForm.value.tool_mode = value as ProactiveTaskToolMode;
};

const loadTaskThreads = async () => {
  try {
    const threads = await electronAPI.chat.threads.list();
    taskThreads.value = Array.isArray(threads) ? threads : [];
  } catch {
    taskThreads.value = [];
  }
};

const loadProactiveTasks = async () => {
  tasksLoading.value = true;
  tasksError.value = '';
  try {
    const list = await electronAPI.tasks.list();
    proactiveTasks.value = Array.isArray(list) ? list : [];
  } catch (error: unknown) {
    tasksError.value = `Failed to load tasks: ${getErrorMessage(error)}`;
    proactiveTasks.value = [];
  } finally {
    tasksLoading.value = false;
  }
};

const refreshTasks = async () => {
  await Promise.all([loadProactiveTasks(), loadTaskThreads()]);
};

const toggleTaskTool = (tool: SafeProactiveTaskTool, checked: boolean) => {
  const existing = taskForm.value.tools;
  if (checked) {
    if (!existing.includes(tool)) {
      taskForm.value.tools = [...existing, tool];
    }
    return;
  }
  taskForm.value.tools = existing.filter(item => item !== tool);
};

const formatTaskSchedule = (task: ProactiveTask): string => {
  if (task.schedule_type === 'cron') {
    const cron = task.cron_expression || 'cron';
    const timezone = task.schedule_timezone ? ` (${task.schedule_timezone})` : ' (local time)';
    return `${cron}${timezone}`;
  }
  return `Every ${task.interval_minutes} min`;
};

const formatTaskToolStrategy = (task: ProactiveTask): string => {
  const toolMode = inferProactiveTaskToolMode(task);
  if (toolMode === 'auto') return 'Auto safe tools';
  if (toolMode === 'disabled') return 'Disabled';
  const tools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));
  return tools.length > 0 ? `Manual: ${tools.join(', ')}` : 'Manual (no safe tools)';
};

const createProactiveTask = async () => {
  const form = toRaw(taskForm.value);
  taskCreateError.value = '';
  const name = form.name.trim();
  const prompt = form.prompt.trim();
  if (!name) {
    taskCreateError.value = 'Task name is required.';
    return;
  }
  if (!prompt) {
    taskCreateError.value = 'Task prompt is required.';
    return;
  }
  if (form.schedule_type === 'interval') {
    if (!Number.isFinite(form.interval_minutes) || form.interval_minutes <= 0) {
      taskCreateError.value = 'Interval must be a positive number (minutes).';
      return;
    }
  } else if (!form.cron_expression.trim()) {
    taskCreateError.value = 'Cron expression is required.';
    return;
  }
  if (!form.provider_type) {
    taskCreateError.value = 'Please select a provider.';
    return;
  }
  if (!form.model) {
    taskCreateError.value = 'Please select a model.';
    return;
  }

  const selectedTools = Array.isArray(form.tools) ? [...form.tools] : [];
  if (form.tool_mode === 'manual' && selectedTools.length === 0) {
    taskCreateError.value = 'Select at least one safe tool or choose Auto/Disabled.';
    return;
  }

  taskCreateLoading.value = true;
  try {
    const result = await electronAPI.tasks.create({
      name,
      prompt,
      provider_type: form.provider_type,
      model: form.model,
      interval_minutes: form.interval_minutes,
      schedule_type: form.schedule_type,
      cron_expression: form.schedule_type === 'cron' ? form.cron_expression.trim() : null,
      schedule_timezone:
        form.schedule_type === 'cron' && form.schedule_timezone.trim()
          ? form.schedule_timezone.trim()
          : null,
      enabled: form.enabled,
      notify: form.notify,
      thread_id: form.thread_id || null,
      tool_mode: form.tool_mode,
      tools: selectedTools,
    });

    if (result?.success === false) {
      taskCreateError.value = result?.error || 'Failed to create task.';
      return;
    }

    taskForm.value.name = '';
    taskForm.value.prompt = '';
    taskForm.value.thread_id = '';
    await loadProactiveTasks();
  } catch (error: unknown) {
    taskCreateError.value = `Failed to create task: ${getErrorMessage(error)}`;
  } finally {
    taskCreateLoading.value = false;
  }
};

const runTaskNow = async (task: ProactiveTask) => {
  if (taskRunLoading.value[task.id]) return;
  taskRunLoading.value = { ...taskRunLoading.value, [task.id]: true };
  try {
    const result = await electronAPI.tasks.runNow(task.id);
    if (result?.success === false) {
      tasksError.value = result?.error || 'Task run failed.';
    }
  } catch (error: unknown) {
    tasksError.value = `Task run failed: ${getErrorMessage(error)}`;
  } finally {
    taskRunLoading.value = { ...taskRunLoading.value, [task.id]: false };
    await loadProactiveTasks();
    await loadTaskThreads();
  }
};

const deleteTask = async (task: ProactiveTask) => {
  const confirmed = window.confirm(`Delete task "${task.name}"?\nThis cannot be undone.`);
  if (!confirmed) return;
  try {
    const result = await electronAPI.tasks.delete(task.id);
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to delete task.';
      return;
    }
    proactiveTasks.value = proactiveTasks.value.filter(item => item.id !== task.id);
  } catch (error: unknown) {
    tasksError.value = `Failed to delete task: ${getErrorMessage(error)}`;
  }
};

const toggleTaskEnabled = async (task: ProactiveTask, enabled: boolean) => {
  try {
    const result = await electronAPI.tasks.update(task.id, { enabled });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = `Failed to update task: ${getErrorMessage(error)}`;
  }
};

const toggleTaskNotify = async (task: ProactiveTask, notify: boolean) => {
  try {
    const result = await electronAPI.tasks.update(task.id, { notify });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = `Failed to update task: ${getErrorMessage(error)}`;
  }
};

const updateTaskInterval = async (task: ProactiveTask, raw: string) => {
  const next = Number.parseInt(raw, 10);
  if (!Number.isFinite(next) || next <= 0) {
    tasksError.value = 'Interval must be a positive number (minutes).';
    return;
  }
  try {
    const result = await electronAPI.tasks.update(task.id, { interval_minutes: next });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = `Failed to update task: ${getErrorMessage(error)}`;
  }
};

const updateTaskCron = async (task: ProactiveTask, raw: string) => {
  const cron = raw.trim();
  if (!cron) {
    tasksError.value = 'Cron expression is required.';
    return;
  }
  try {
    const result = await electronAPI.tasks.update(task.id, {
      cron_expression: cron,
    });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = `Failed to update task: ${getErrorMessage(error)}`;
  }
};

const updateTaskTimezone = async (task: ProactiveTask, raw: string) => {
  const timezone = raw.trim();
  try {
    const result = await electronAPI.tasks.update(task.id, {
      schedule_timezone: timezone || null,
    });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = `Failed to update task: ${getErrorMessage(error)}`;
  }
};

watch(
  () => props.providers,
  providers => {
    if (!taskForm.value.provider_type && providers.length > 0) {
      taskForm.value.provider_type = providers[0].type;
    }

    const models = taskAvailableModels.value;
    if (!taskForm.value.model || (models.length > 0 && !models.includes(taskForm.value.model))) {
      taskForm.value.model = models[0] || '';
    }
  },
  { immediate: true }
);

watch(
  () => taskForm.value.provider_type,
  () => {
    const models = taskAvailableModels.value;
    if (!taskForm.value.model || (models.length > 0 && !models.includes(taskForm.value.model))) {
      taskForm.value.model = models[0] || '';
    }
  }
);

watch(
  () => props.active,
  active => {
    if (active) {
      void refreshTasks();
    }
  },
  { immediate: true }
);

onMounted(() => {
  try {
    electronAPI.tasks.removeAllListeners?.();
    electronAPI.tasks.onPush((payload: unknown) => {
      if (isTaskPushPayload(payload) && payload.type === 'task-result') {
        void loadProactiveTasks();
      }
    });
  } catch {
    // Ignore missing tasks IPC when running older builds.
  }
});

onUnmounted(() => {
  try {
    electronAPI.tasks.removeAllListeners?.();
  } catch {
    // ignore
  }
});
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.task-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.task-tools {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px;
  background: var(--bg-secondary);
  margin-bottom: 14px;
}

.task-tools-title {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 0.92em;
  margin-bottom: 10px;
}

.task-tools-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-item {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  padding: 14px;
}

.task-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-name {
  max-width: 520px;
}

.task-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.task-item-meta {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.task-compact-check {
  margin-bottom: 0;
}

.task-inline-field {
  margin-bottom: 0;
  width: 160px;
}

.task-cron-field {
  width: 260px;
  flex: 1 1 260px;
}

.task-timezone-field {
  width: 160px;
}

.task-inline-field input {
  margin-top: 4px;
}

.task-item-schedule {
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 0.9em;
}

.task-item-times {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 0.9em;
}

.task-error-block {
  margin-top: 12px;
  background: color-mix(in srgb, var(--danger-color) 7%, var(--bg-primary));
  border: 1px solid color-mix(in srgb, var(--danger-color) 25%, var(--border-color));
  border-radius: 12px;
  padding: 10px 12px;
}

.skills-mini-btn {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.skills-mini-btn:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}

@media (max-width: 840px) {
  .task-form-grid {
    grid-template-columns: 1fr;
  }

  .task-tools-grid {
    grid-template-columns: 1fr;
  }

  .task-name {
    max-width: 320px;
  }
}
</style>
