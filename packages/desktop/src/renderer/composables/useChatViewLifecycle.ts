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
  electronAPI: Pick<ElectronApi, 'chat' | 'awaiters'>;
  handleAwaiterPush: (payload: unknown) => Promise<void> | void;
}) => {
  let removeAwaiterPushListener: () => void = () => undefined;

  onMounted(async () => {
    if (!deps.configStore.initialized) {
      await deps.configStore.initialize();
    }

    await deps.refreshThreads();
    await deps.loadToolSources();

    try {
      removeAwaiterPushListener();
      removeAwaiterPushListener =
        deps.electronAPI.awaiters?.onPush?.((payload: unknown) => {
          runSafe(() => deps.handleAwaiterPush(payload));
        }) ?? (() => undefined);
    } catch {
      /* empty: error is not actionable here */
    }
  });

  onUnmounted(() => {
    try {
      removeAwaiterPushListener();
    } catch {
      /* empty: error is not actionable here */
    }
  });
};
