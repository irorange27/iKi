import { onMounted, onUnmounted, watch, type Ref } from 'vue';

import type { ElectronApi } from '../../shared/types/electron_api';

export const useChatComposerLifecycle = (deps: {
  electronAPI: Pick<ElectronApi, 'providers'>;
  threadId: Ref<string | undefined>;
  activeModel: Ref<string | undefined>;
  activeProviderId: Ref<string | null | undefined>;
  isBusy: Ref<boolean>;
  loadAvailableProviders: (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => Promise<void>;
  syncPreferredModel: (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => void;
  syncToolSelectionFromThread: (threadId?: string) => Promise<void>;
  loadSpeechStatus: () => Promise<void>;
}) => {
  let removeProviderUpdateListener: () => void = () => undefined;
  let syncInProgress = false;

  watch(
    () => [deps.threadId.value, deps.isBusy.value] as const,
    async ([threadId, busy], [previousThreadId, previousBusy]) => {
      if (busy) return;
      if (threadId === previousThreadId && previousBusy === busy) return;
      if (syncInProgress) return;
      syncInProgress = true;
      try {
        await deps.syncToolSelectionFromThread(threadId);
      } finally {
        syncInProgress = false;
      }
    }
  );

  watch(
    () => [deps.activeModel.value, deps.activeProviderId.value] as const,
    ([activeModel, activeProviderId], [previousActiveModel, previousActiveProviderId]) => {
      if (activeModel === previousActiveModel && activeProviderId === previousActiveProviderId) {
        return;
      }
      deps.syncPreferredModel(activeModel, activeProviderId);
    }
  );

  onMounted(async () => {
    if (typeof deps.electronAPI.providers.onUpdated === 'function') {
      removeProviderUpdateListener = deps.electronAPI.providers.onUpdated(() => {
        void deps.loadAvailableProviders();
      });
    }

    await deps.loadAvailableProviders(deps.activeModel.value, deps.activeProviderId.value);
    await deps.loadSpeechStatus();
    await deps.syncToolSelectionFromThread(deps.threadId.value);
  });

  onUnmounted(() => {
    removeProviderUpdateListener();
  });
};
