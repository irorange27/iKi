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
  handleChatChunk?: (chunk: unknown) => Promise<void> | void;
  handleTaskPush: (payload: unknown) => Promise<void> | void;
}) => {
  let removeChatChunkListener: () => void = () => undefined;
  let removeTaskPushListener: () => void = () => undefined;

  onMounted(async () => {
    if (!deps.configStore.initialized) {
      await deps.configStore.initialize();
    }

    await deps.refreshThreads();
    await deps.loadToolSources();

    removeChatChunkListener();
    removeChatChunkListener = deps.electronAPI.chat.onUiChunk((chunk: unknown) => {
      void deps.streamController.handleUiChunk(chunk);
      void deps.handleChatChunk?.(chunk);
    });

    try {
      removeTaskPushListener();
      removeTaskPushListener =
        deps.electronAPI.tasks?.onPush?.((payload: unknown) => {
          void deps.handleTaskPush(payload);
        }) ?? (() => undefined);
    } catch {
      // Ignore missing tasks IPC in older builds.
    }
  });

  onUnmounted(() => {
    removeChatChunkListener();
    try {
      removeTaskPushListener();
    } catch {
      // ignore
    }
  });
};
