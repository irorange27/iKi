import { computed, onUnmounted, ref, toRaw, watch, type Ref } from 'vue';

import { useI18n } from '../i18n';
import { createLogger } from '../logger';
import { getElectronAPI } from '../services/electron_api';
import type { ChatThread } from '@iki/backend/types/chat';
import type {
  ProactiveTask,
  ProactiveTaskToolMode,
  SafeProactiveTaskTool,
} from '@iki/backend/types/tasks';
import {
  SAFE_PROACTIVE_TASK_TOOLS,
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  parseProactiveTaskTools,
} from '@iki/backend/types/tasks';
import { getErrorMessage } from '@iki/backend/utils/errors';

export type TaskProviderModels = {
  id: string;
  name: string;
  type: string;
  models: string[];
};

type TaskForm = {
  name: string;
  prompt: string;
  schedule_type: 'interval' | 'cron';
  interval_minutes: number;
  cron_expression: string;
  schedule_timezone: string;
  enabled: boolean;
  notify: boolean;
  provider_id: string;
  provider_type: string;
  model: string;
  thread_id: string;
  tool_mode: ProactiveTaskToolMode;
  tools: SafeProactiveTaskTool[];
};

const createDefaultTaskForm = (): TaskForm => ({
  name: '',
  prompt: '',
  schedule_type: 'interval',
  interval_minutes: 60,
  cron_expression: '',
  schedule_timezone: '',
  enabled: true,
  notify: true,
  provider_id: '',
  provider_type: '',
  model: '',
  thread_id: '',
  tool_mode: 'auto',
  tools: ['web', 'fetch'],
});

const isTaskPushPayload = (payload: unknown): payload is { type?: string } =>
  typeof payload === 'object' && payload !== null && 'type' in payload;

const tasksSectionLogger = createLogger({ module: 'settings_tasks' });

export const useSettingsTasksSection = (params: {
  active: Readonly<Ref<boolean>>;
  providers: Readonly<Ref<TaskProviderModels[]>>;
  formatTimestamp: (value: string | number | Date) => string;
}) => {
  const electronAPI = getElectronAPI();
  const { t } = useI18n();

  const proactiveTasks = ref<ProactiveTask[]>([]);
  const tasksLoading = ref(false);
  const tasksError = ref('');
  const taskCreateLoading = ref(false);
  const taskCreateError = ref('');
  const taskRunLoading = ref<Record<string, boolean>>({});
  const taskThreads = ref<ChatThread[]>([]);
  const taskForm = ref<TaskForm>(createDefaultTaskForm());
  let removeTaskPushListener: () => void = () => undefined;

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

  const taskProviderOptions = computed(() =>
    params.providers.value.map(provider => ({
      value: provider.id,
      label: `${provider.name} (${provider.type})`,
    }))
  );

  const selectedProvider = computed(() =>
    params.providers.value.find(provider => provider.id === taskForm.value.provider_id) || null
  );

  const taskAvailableModels = computed(() => {
    return selectedProvider.value?.models || [];
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
    taskForm.value.schedule_type = value as TaskForm['schedule_type'];
  };

  const updateTaskProviderSelection = (value: string) => {
    taskForm.value.provider_id = value;
    const provider = params.providers.value.find(candidate => candidate.id === value) || null;
    taskForm.value.provider_type = provider?.type || '';
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
    } catch (error) {
      tasksSectionLogger.event({
        level: 'warn',
        event: 'settings.tasks.threads_load',
        outcome: 'failed',
        error,
      });
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
      return t('settings.tasks.format.scheduleCron', {
        cron: task.cron_expression || 'cron',
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
        provider_id: form.provider_id || null,
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
    () => params.providers.value,
    providers => {
      if (!taskForm.value.provider_id && providers.length > 0) {
        taskForm.value.provider_id = providers[0].id;
        taskForm.value.provider_type = providers[0].type;
      }

      const provider =
        providers.find(candidate => candidate.id === taskForm.value.provider_id) || null;
      taskForm.value.provider_type = provider?.type || '';

      const models = taskAvailableModels.value;
      if (!taskForm.value.model || (models.length > 0 && !models.includes(taskForm.value.model))) {
        taskForm.value.model = models[0] || '';
      }
    },
    { immediate: true }
  );

  watch(
    () => taskForm.value.provider_id,
    () => {
      const provider =
        params.providers.value.find(candidate => candidate.id === taskForm.value.provider_id) || null;
      taskForm.value.provider_type = provider?.type || '';
      const models = taskAvailableModels.value;
      if (!taskForm.value.model || (models.length > 0 && !models.includes(taskForm.value.model))) {
        taskForm.value.model = models[0] || '';
      }
    }
  );

  watch(
    () => params.active.value,
    active => {
      if (active) {
        void refreshTasks();
      }
    },
    { immediate: true }
  );

  try {
    removeTaskPushListener =
      electronAPI.tasks.onPush((payload: unknown) => {
        if (isTaskPushPayload(payload) && payload.type === 'task-result') {
          void loadProactiveTasks();
        }
      }) ?? (() => undefined);
  } catch {
    // Ignore missing tasks IPC when running older builds.
  }

  onUnmounted(() => {
    try {
      removeTaskPushListener();
    } catch {
      // ignore
    }
  });

  return {
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
    formatTimestamp: params.formatTimestamp,
  };
};
