import { onMounted, onUnmounted, watch, type Ref } from 'vue';

import type { ElectronApi } from '@iki/backend/types/electron_api';

export const useChatComposerLifecycle = (deps: {
  electronAPI: Pick<ElectronApi, 'providers'>;
  activeModel: Ref<string | undefined>;
  activeProviderId: Ref<string | null | undefined>;
  loadAvailableProviders: (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => Promise<void>;
  syncPreferredModel: (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => void;
  loadSpeechStatus: () => Promise<void>;
}) => {
  let removeProviderUpdateListener: () => void = () => undefined;

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
  });

  onUnmounted(() => {
    removeProviderUpdateListener();
  });
};
