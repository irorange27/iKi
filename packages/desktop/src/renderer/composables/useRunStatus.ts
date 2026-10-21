import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import type { ElectronApi, RunStatusEvent } from '@iki/backend/types/electron_api';

export type RunStatusState = {
  currentStatus: Ref<string | null>;
  isActive: Ref<boolean>;
};

export const useRunStatus = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
}): RunStatusState => {
  const currentStatus = ref<string | null>(null);
  const isActive = ref(false);

  const handleRunStatus = (event: RunStatusEvent) => {
    currentStatus.value = event.status;
    isActive.value = event.status === 'running' || event.status === 'blocked';
  };

  let removeListener: () => void = () => undefined;

  onMounted(() => {
    removeListener = deps.electronAPI.chat.onRunStatus(handleRunStatus);
  });

  onUnmounted(() => {
    try {
      removeListener();
    } catch {
    }
  });

  return { currentStatus, isActive };
};
