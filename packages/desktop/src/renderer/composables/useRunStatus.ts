import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import type { ElectronApi, RunStatusEvent } from '@iki/core/types/electron_api';

export type RunStatusState = {
  currentRunId: Ref<string | null>;
  currentStatus: Ref<string | null>;
  currentThreadId: Ref<string | null>;
  isActive: Ref<boolean>;
};

export const useRunStatus = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
}): RunStatusState => {
  const currentRunId = ref<string | null>(null);
  const currentStatus = ref<string | null>(null);
  const currentThreadId = ref<string | null>(null);
  const isActive = ref(false);

  const handleRunStatus = (event: RunStatusEvent) => {
    currentRunId.value = event.runId;
    currentStatus.value = event.status;
    currentThreadId.value = event.threadId ?? null;

    isActive.value = event.status === 'running' || event.status === 'blocked';
  };

  let removeListener: () => void = () => undefined;

  onMounted(() => {
    try {
      removeListener = deps.electronAPI.chat.onRunStatus?.(handleRunStatus) ?? (() => undefined);
    } catch {
      // onRunStatus not available in older builds
    }
  });

  onUnmounted(() => {
    try {
      removeListener();
    } catch {
      // ignore
    }
  });

  return {
    currentRunId,
    currentStatus,
    currentThreadId,
    isActive,
  };
};
