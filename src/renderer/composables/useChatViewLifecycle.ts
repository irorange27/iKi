import { onMounted, onUnmounted } from 'vue';

import type { ChatUiStreamController } from '../modules/chat/ui_stream_controller';
import type { ElectronApi } from '../../shared/types/electron_api';

type ConfigInitializer = {
  initialized: boolean;
  initialize: () => Promise<void>;
};

export const useChatViewLifecycle = (deps: {
  configStore: ConfigInitializer;
  refreshThreads: () => Promise<void>;
  loadToolSources: () => Promise<void>;
  electronAPI: Pick<ElectronApi, 'chat' | 'tasks'>;
  streamController: Pick<ChatUiStreamController, 'handleUiChunk'>;
  handleTaskPush: (payload: unknown) => Promise<void> | void;
}) => {
  onMounted(async () => {
    if (!deps.configStore.initialized) {
      await deps.configStore.initialize();
    }

    await deps.refreshThreads();
    await deps.loadToolSources();

    deps.electronAPI.chat.removeAllListeners();
    deps.electronAPI.chat.onUiChunk((chunk: unknown) => {
      void deps.streamController.handleUiChunk(chunk);
    });

    try {
      deps.electronAPI.tasks?.removeAllListeners?.();
      deps.electronAPI.tasks?.onPush?.((payload: unknown) => {
        void deps.handleTaskPush(payload);
      });
    } catch {
      // Ignore missing tasks IPC in older builds.
    }
  });

  onUnmounted(() => {
    deps.electronAPI.chat.removeAllListeners();
    try {
      deps.electronAPI.tasks?.removeAllListeners?.();
    } catch {
      // ignore
    }
  });
};
