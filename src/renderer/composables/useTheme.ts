import { watchEffect, onUnmounted } from 'vue';
import { useConfigStore } from '../store/config';

export function useTheme() {
  const configStore = useConfigStore();

  const stop = watchEffect(() => {
    if (configStore.config) {
      configStore.applyCssVariables();
    }
  });

  onUnmounted(() => {
    stop();
  });
}
