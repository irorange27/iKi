import { onMounted, onUnmounted } from 'vue';

import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../logger';

type ConfigInitializer = {
  initialized: boolean;
  initialize: () => Promise<void>;
};

const chatViewLifecycleLogger = createLogger({ module: 'chat_view_lifecycle' });

const runSafe = (fn: () => unknown) => {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        chatViewLifecycleLogger.event({
          level: 'warn',
          event: 'chat.lifecycle.callback_error',
          outcome: 'failed',
          error,
        });
      });
    }
  } catch (error) {
    chatViewLifecycleLogger.event({
      level: 'warn',
      event: 'chat.lifecycle.callback_error',
      outcome: 'failed',
      error,
    });
  }
};

export const useChatViewLifecycle = (deps: {
  configStore: ConfigInitializer;
  refreshThreads: () => Promise<void>;
  loadToolSources: () => Promise<void>;
  electronAPI: Pick<ElectronApi, 'chat' | 'tasks' | 'awaiters'>;
  handleTaskPush: (payload: unknown) => Promise<void> | void;
  handleAwaiterPush: (payload: unknown) => Promise<void> | void;
}) => {
  let removeTaskPushListener: () => void = () => undefined;
  let removeAwaiterPushListener: () => void = () => undefined;

  onMounted(async () => {
    if (!deps.configStore.initialized) {
      await deps.configStore.initialize();
    }

    await deps.refreshThreads();
    await deps.loadToolSources();

    try {
      removeTaskPushListener();
      removeTaskPushListener =
        deps.electronAPI.tasks?.onPush?.((payload: unknown) => {
          runSafe(() => deps.handleTaskPush(payload));
        }) ?? (() => undefined);
    } catch {
      // Ignore missing tasks IPC in older builds.
    }

    try {
      removeAwaiterPushListener();
      removeAwaiterPushListener =
        deps.electronAPI.awaiters?.onPush?.((payload: unknown) => {
          runSafe(() => deps.handleAwaiterPush(payload));
        }) ?? (() => undefined);
    } catch {
      // Ignore missing awaiter IPC in older builds.
    }
  });

  onUnmounted(() => {
    try {
      removeTaskPushListener();
    } catch {
      // ignore
    }
    try {
      removeAwaiterPushListener();
    } catch {
      // ignore
    }
  });
};
