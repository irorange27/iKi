<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="card-title">{{ t('settings.tasks.title') }}</div>
      <p class="card-help">{{ t('settings.tasks.description') }}</p>

      <label class="input-label">
        <span>{{ t('common.name') }}</span>
        <input v-model="taskForm.name" type="text" :placeholder="t('settings.tasks.namePlaceholder')" />
      </label>

      <label class="input-label">
        <span>{{ t('settings.tasks.promptLabel') }}</span>
        <textarea v-model="taskForm.prompt" :placeholder="t('settings.tasks.promptPlaceholder')" />
      </label>

      <label class="input-label">
        <span>{{ t('settings.tasks.scheduleType') }}</span>
        <SettingsSelect
          :model-value="taskForm.schedule_type"
          :options="taskScheduleTypeOptions"
          :aria-label="t('settings.tasks.scheduleTypeAria')"
          @update:model-value="updateTaskScheduleTypeSelection"
        />
      </label>

      <div class="task-form-grid">
        <label class="input-label">
          <span>{{
            taskForm.schedule_type === 'cron'
              ? t('settings.tasks.cronExpression')
              : t('settings.tasks.everyMinutes')
          }}</span>
          <input
            v-if="taskForm.schedule_type === 'interval'"
            v-model.number="taskForm.interval_minutes"
            type="number"
            min="1"
            max="10080"
          />
          <input
            v-else
            v-model="taskForm.cron_expression"
            type="text"
            :placeholder="t('settings.tasks.cronPlaceholder')"
          />
          <div v-if="taskForm.schedule_type === 'cron'" class="input-hint">
            {{ t('settings.tasks.cronHint') }}
          </div>
        </label>

        <label class="input-label">
          <span>{{ t('common.provider') }}</span>
          <SettingsSelect
            :model-value="taskForm.provider_type"
            :options="taskProviderOptions"
            :disabled="taskProviderOptions.length === 0"
            :placeholder="t('settings.tasks.selectProvider')"
            :empty-text="t('settings.tasks.noProviders')"
            :aria-label="t('settings.tasks.providerAria')"
            @update:model-value="updateTaskProviderSelection"
          />
        </label>
      </div>

      <label v-if="taskForm.schedule_type === 'cron'" class="input-label">
        <span>{{ t('settings.tasks.timezoneOptional') }}</span>
        <input
          v-model="taskForm.schedule_timezone"
          type="text"
          :placeholder="t('settings.tasks.timezonePlaceholder')"
        />
      </label>

      <label class="input-label">
        <span>{{ t('common.model') }}</span>
        <SettingsSelect
          :model-value="taskForm.model"
          :options="taskModelOptions"
          :disabled="taskModelOptions.length === 0"
          :placeholder="t('settings.tasks.selectModel')"
          :empty-text="t('settings.tasks.noModels')"
          :aria-label="t('settings.tasks.modelAria')"
          @update:model-value="updateTaskModelSelection"
        />
      </label>

      <label class="input-label">
        <span>{{ t('settings.tasks.pushToThread') }}</span>
        <SettingsSelect
          :model-value="taskForm.thread_id"
          :options="taskThreadOptions"
          :aria-label="t('settings.tasks.threadAria')"
          @update:model-value="updateTaskThreadSelection"
        />
      </label>

      <label class="input-label">
        <span>{{ t('settings.tasks.toolStrategy') }}</span>
        <SettingsSelect
          :model-value="taskForm.tool_mode"
          :options="taskToolModeOptions"
          :aria-label="t('settings.tasks.toolStrategyAria')"
          @update:model-value="updateTaskToolModeSelection"
        />
        <div class="input-hint">
          {{ t('settings.tasks.toolStrategyHint') }}
        </div>
      </label>

      <div v-if="taskForm.tool_mode === 'manual'" class="task-tools">
        <div class="task-tools-title">{{ t('settings.tasks.allowedTools') }}</div>
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
            ? t('settings.tasks.disabledHint')
            : t('settings.tasks.autoHint')
        }}
      </p>

      <label class="checkbox-label">
        <input type="checkbox" v-model="taskForm.enabled" />
        {{ t('common.enabled') }}
      </label>

      <label class="checkbox-label">
        <input type="checkbox" v-model="taskForm.notify" />
        {{ t('settings.tasks.desktopNotification') }}
      </label>

      <div class="task-form-actions">
        <button class="secondary-btn" @click="createProactiveTask" :disabled="taskCreateLoading">
          {{ taskCreateLoading ? t('settings.tasks.creating') : t('settings.tasks.create') }}
        </button>
        <button class="secondary-btn" @click="refreshTasks" :disabled="tasksLoading">
          {{ t('common.refresh') }}
        </button>
      </div>

      <p v-if="taskCreateError" class="tasks-error">{{ taskCreateError }}</p>
      <p v-if="tasksError" class="tasks-error">{{ tasksError }}</p>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.tasks.existingTitle') }}</div>

      <div v-if="tasksLoading" class="tasks-empty">{{ t('settings.tasks.loading') }}</div>
      <div v-else-if="proactiveTasks.length === 0" class="tasks-empty">
        {{ t('settings.tasks.empty') }}
      </div>
      <div v-else class="tasks-list">
        <div v-for="task in proactiveTasks" :key="task.id" class="task-item">
          <div class="task-item-header">
            <div class="task-item-title">
              <span class="task-name">{{ task.name }}</span>
              <span class="task-status" :class="`status-${task.last_status || 'idle'}`">
                {{ formatTaskStatus(task.last_status || 'idle') }}
              </span>
            </div>
            <div class="task-item-actions">
              <button
                class="skills-mini-btn"
                @click="runTaskNow(task)"
                :disabled="!!taskRunLoading[task.id]"
              >
                {{ taskRunLoading[task.id] ? t('settings.tasks.running') : t('settings.tasks.runNow') }}
              </button>
              <button class="skills-mini-btn" @click="deleteTask(task)">{{ t('common.delete') }}</button>
            </div>
          </div>

          <div class="task-item-meta">
            <label class="checkbox-label task-compact-check">
              <input
                type="checkbox"
                :checked="task.enabled"
                @change="toggleTaskEnabled(task, ($event.target as HTMLInputElement).checked)"
              />
              {{ t('common.enabled') }}
            </label>
            <label class="checkbox-label task-compact-check">
              <input
                type="checkbox"
                :checked="task.notify"
                @change="toggleTaskNotify(task, ($event.target as HTMLInputElement).checked)"
              />
              {{ t('settings.tasks.notify') }}
            </label>
            <template v-if="task.schedule_type === 'cron'">
              <label class="input-label task-inline-field task-cron-field">
                <span>{{ t('settings.tasks.cronShort') }}</span>
                <input
                  type="text"
                  :value="task.cron_expression || ''"
                  :placeholder="t('settings.tasks.cronPlaceholder')"
                  @change="updateTaskCron(task, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label class="input-label task-inline-field task-timezone-field">
                <span>{{ t('settings.tasks.tzShort') }}</span>
                <input
                  type="text"
                  :value="task.schedule_timezone || ''"
                  :placeholder="t('settings.tasks.local')"
                  @change="updateTaskTimezone(task, ($event.target as HTMLInputElement).value)"
                />
              </label>
            </template>
            <label v-else class="input-label task-inline-field">
              <span>{{ t('settings.tasks.everyMinShort') }}</span>
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
            <span class="task-meta-label">{{ t('settings.tasks.scheduleLabel') }}</span>
            {{ formatTaskSchedule(task) }}
          </div>

          <div class="task-item-schedule">
            <span class="task-meta-label">{{ t('settings.tasks.toolStrategyLabel') }}</span>
            {{ formatTaskToolStrategy(task) }}
          </div>

          <div class="task-item-times">
            <div>
              <span class="task-meta-label">{{ t('settings.tasks.next') }}</span>
              {{ task.next_run_at ? formatTimestamp(task.next_run_at) : '-' }}
            </div>
            <div>
              <span class="task-meta-label">{{ t('settings.tasks.last') }}</span>
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
import { useI18n } from '../../i18n';
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
const { t } = useI18n();

const proactiveTasks = ref<ProactiveTask[]>([]);
const tasksLoading = ref(false);
const tasksError = ref('');
const taskCreateLoading = ref(false);
const taskCreateError = ref('');
const taskRunLoading = ref<Record<string, boolean>>({});
const taskThreads = ref<ChatThread[]>([]);

const SAFE_TASK_TOOLS = SAFE_PROACTIVE_TASK_TOOLS;
const taskScheduleTypeOptions = computed(() => [
  { value: 'interval', label: t('settings.tasks.schedule.interval') },
  { value: 'cron', label: t('settings.tasks.schedule.cron') },
]);
const taskToolModeOptions = computed(() => [
  { value: 'auto', label: t('settings.tasks.toolMode.auto') },
  { value: 'manual', label: t('settings.tasks.toolMode.manual') },
  { value: 'disabled', label: t('settings.tasks.toolMode.disabled') },
]);

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
  { value: '', label: t('settings.tasks.autoCreateThread') },
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
    tasksError.value = t('settings.tasks.error.loadFailed', { error: getErrorMessage(error) });
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
    return t('settings.tasks.format.scheduleCron', {
      cron,
      timezone: task.schedule_timezone || '',
    });
  }
  return t('settings.tasks.format.scheduleInterval', { minutes: task.interval_minutes });
};

const formatTaskToolStrategy = (task: ProactiveTask): string => {
  const toolMode = inferProactiveTaskToolMode(task);
  if (toolMode === 'auto') return t('settings.tasks.format.toolAuto');
  if (toolMode === 'disabled') return t('settings.tasks.format.toolDisabled');
  const tools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));
  return t('settings.tasks.format.toolManual', { tools: tools.join(', ') });
};

const formatTaskStatus = (status: string) => {
  if (status === 'running') return t('settings.tasks.status.running');
  if (status === 'success') return t('settings.tasks.status.success');
  if (status === 'error') return t('settings.tasks.status.error');
  return t('settings.tasks.status.idle');
};

const createProactiveTask = async () => {
  const form = toRaw(taskForm.value);
  taskCreateError.value = '';
  const name = form.name.trim();
  const prompt = form.prompt.trim();
  if (!name) {
    taskCreateError.value = t('settings.tasks.error.nameRequired');
    return;
  }
  if (!prompt) {
    taskCreateError.value = t('settings.tasks.error.promptRequired');
    return;
  }
  if (form.schedule_type === 'interval') {
    if (!Number.isFinite(form.interval_minutes) || form.interval_minutes <= 0) {
      taskCreateError.value = t('settings.tasks.error.intervalPositive');
      return;
    }
  } else if (!form.cron_expression.trim()) {
    taskCreateError.value = t('settings.tasks.error.cronRequired');
    return;
  }
  if (!form.provider_type) {
    taskCreateError.value = t('settings.tasks.error.providerRequired');
    return;
  }
  if (!form.model) {
    taskCreateError.value = t('settings.tasks.error.modelRequired');
    return;
  }

  const selectedTools = Array.isArray(form.tools) ? [...form.tools] : [];
  if (form.tool_mode === 'manual' && selectedTools.length === 0) {
    taskCreateError.value = t('settings.tasks.error.safeToolRequired');
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
      taskCreateError.value =
        result?.error || t('settings.tasks.error.createFailed', { error: '' });
      return;
    }

    taskForm.value.name = '';
    taskForm.value.prompt = '';
    taskForm.value.thread_id = '';
    await loadProactiveTasks();
  } catch (error: unknown) {
    taskCreateError.value = t('settings.tasks.error.createFailed', {
      error: getErrorMessage(error),
    });
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
      tasksError.value = result?.error || t('settings.tasks.error.runFailed', { error: '' });
    }
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.runFailed', { error: getErrorMessage(error) });
  } finally {
    taskRunLoading.value = { ...taskRunLoading.value, [task.id]: false };
    await loadProactiveTasks();
    await loadTaskThreads();
  }
};

const deleteTask = async (task: ProactiveTask) => {
  const confirmed = window.confirm(t('settings.tasks.confirmDelete', { name: task.name }));
  if (!confirmed) return;
  try {
    const result = await electronAPI.tasks.delete(task.id);
    if (result?.success === false) {
      tasksError.value = result?.error || t('settings.tasks.error.deleteFailed', { error: '' });
      return;
    }
    proactiveTasks.value = proactiveTasks.value.filter(item => item.id !== task.id);
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.deleteFailed', { error: getErrorMessage(error) });
  }
};

const toggleTaskEnabled = async (task: ProactiveTask, enabled: boolean) => {
  try {
    const result = await electronAPI.tasks.update(task.id, { enabled });
    if (result?.success === false) {
      tasksError.value = result?.error || t('settings.tasks.error.updateFailed', { error: '' });
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.updateFailed', { error: getErrorMessage(error) });
  }
};

const toggleTaskNotify = async (task: ProactiveTask, notify: boolean) => {
  try {
    const result = await electronAPI.tasks.update(task.id, { notify });
    if (result?.success === false) {
      tasksError.value = result?.error || t('settings.tasks.error.updateFailed', { error: '' });
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.updateFailed', { error: getErrorMessage(error) });
  }
};

const updateTaskInterval = async (task: ProactiveTask, raw: string) => {
  const next = Number.parseInt(raw, 10);
  if (!Number.isFinite(next) || next <= 0) {
    tasksError.value = t('settings.tasks.error.intervalPositive');
    return;
  }
  try {
    const result = await electronAPI.tasks.update(task.id, { interval_minutes: next });
    if (result?.success === false) {
      tasksError.value = result?.error || t('settings.tasks.error.updateFailed', { error: '' });
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.updateFailed', { error: getErrorMessage(error) });
  }
};

const updateTaskCron = async (task: ProactiveTask, raw: string) => {
  const cron = raw.trim();
  if (!cron) {
    tasksError.value = t('settings.tasks.error.cronRequired');
    return;
  }
  try {
    const result = await electronAPI.tasks.update(task.id, {
      cron_expression: cron,
    });
    if (result?.success === false) {
      tasksError.value = result?.error || t('settings.tasks.error.updateFailed', { error: '' });
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.updateFailed', { error: getErrorMessage(error) });
  }
};

const updateTaskTimezone = async (task: ProactiveTask, raw: string) => {
  const timezone = raw.trim();
  try {
    const result = await electronAPI.tasks.update(task.id, {
      schedule_timezone: timezone || null,
    });
    if (result?.success === false) {
      tasksError.value = result?.error || t('settings.tasks.error.updateFailed', { error: '' });
      return;
    }
    await loadProactiveTasks();
  } catch (error: unknown) {
    tasksError.value = t('settings.tasks.error.updateFailed', { error: getErrorMessage(error) });
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
