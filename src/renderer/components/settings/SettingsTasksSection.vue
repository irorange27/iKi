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
            :model-value="taskForm.provider_id"
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
import { toRef } from 'vue';

import SettingsSelect from './SettingsSelect.vue';
import { formatTimestamp } from './settings_formatters';
import {
  useSettingsTasksSection,
  type TaskProviderModels,
} from '../../composables/useSettingsTasksSection';

const props = defineProps<{
  active: boolean;
  providers: TaskProviderModels[];
}>();
const {
  SAFE_TASK_TOOLS,
  createProactiveTask,
  deleteTask,
  formatTaskSchedule,
  formatTaskStatus,
  formatTaskToolStrategy,
  proactiveTasks,
  refreshTasks,
  runTaskNow,
  taskCreateError,
  taskCreateLoading,
  taskForm,
  taskModelOptions,
  taskProviderOptions,
  taskRunLoading,
  taskScheduleTypeOptions,
  taskThreadOptions,
  taskToolModeOptions,
  tasksError,
  tasksLoading,
  t,
  toggleTaskEnabled,
  toggleTaskNotify,
  toggleTaskTool,
  updateTaskCron,
  updateTaskInterval,
  updateTaskModelSelection,
  updateTaskProviderSelection,
  updateTaskScheduleTypeSelection,
  updateTaskThreadSelection,
  updateTaskTimezone,
  updateTaskToolModeSelection,
} = useSettingsTasksSection({
  active: toRef(props, 'active'),
  providers: toRef(props, 'providers'),
  formatTimestamp,
});
</script>

<style scoped src="./settings_shared.css"></style>
<style scoped src="./settings_tasks_section.css"></style>
