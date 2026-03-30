import { computed, ref, watch, type Ref } from 'vue';

import type { ElectronApi } from '../../shared/types/electron_api';
import type { TaskPlan } from '../../shared/types/task_plan';
import { isObjectRecord } from '../../shared/utils/guards';
import { createLogger } from '../logger';

const chatThreadTodoPlanLogger = createLogger({ module: 'chat_thread_todo_plan' });

const normalizeThreadId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const hasActiveTodoItems = (plan: TaskPlan | null): plan is TaskPlan =>
  Boolean(plan && Array.isArray(plan.items) && plan.items.some(item => item.status !== 'completed'));

const shouldRefreshForChunk = (chunk: unknown): boolean => {
  if (!isObjectRecord(chunk) || typeof chunk.type !== 'string') return false;

  return (
    chunk.type === 'tool-output-available' ||
    chunk.type === 'tool-output-error' ||
    chunk.type === 'tool-output-denied' ||
    chunk.type === 'finish' ||
    chunk.type === 'abort' ||
    chunk.type === 'error'
  );
};

export const useChatThreadTodoPlan = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
  threadId: Ref<string | null>;
}) => {
  const todoPlan = ref<TaskPlan | null>(null);
  let latestRequestId = 0;

  const loadTodoPlan = async (threadIdOverride?: string | null) => {
    const requestId = latestRequestId + 1;
    latestRequestId = requestId;

    const threadId = normalizeThreadId(threadIdOverride ?? deps.threadId.value);
    if (!threadId) {
      todoPlan.value = null;
      return;
    }

    try {
      const plan = await deps.electronAPI.chat.threads.getTodoPlan(threadId);
      if (requestId !== latestRequestId) return;
      todoPlan.value = plan;
    } catch (error) {
      if (requestId !== latestRequestId) return;
      todoPlan.value = null;
      chatThreadTodoPlanLogger.event({
        level: 'warn',
        event: 'chat.todo_plan.load',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
        },
      });
    }
  };

  watch(
    () => deps.threadId.value,
    nextThreadId => {
      void loadTodoPlan(nextThreadId);
    },
    { immediate: true }
  );

  const activeTodoPlan = computed<TaskPlan | null>(() =>
    hasActiveTodoItems(todoPlan.value) ? todoPlan.value : null
  );

  const handleChatChunk = (chunk: unknown) => {
    if (!shouldRefreshForChunk(chunk)) return;
    if (!normalizeThreadId(deps.threadId.value)) return;
    void loadTodoPlan();
  };

  return {
    todoPlan,
    activeTodoPlan,
    refreshTodoPlan: loadTodoPlan,
    handleChatChunk,
  };
};
