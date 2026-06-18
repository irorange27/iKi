<template>
  <section class="config-section">
    <div class="config-group">
      <h3>{{ t('settings.advanced.title') }}</h3>
      <label
        v-for="key in ['debugMode', 'developerMode', 'enableExperimentalFeatures'] as const"
        :key="key"
        class="checkbox-label"
      >
        <input
          type="checkbox"
          :checked="config.advanced[key]"
          @change="updateAdvanced(key, ($event.target as HTMLInputElement).checked)"
        />
        {{ formatAdvancedLabel(key) }}
      </label>
    </div>

    <button class="reset-btn" @click="emit('reset')">
      {{ t('settings.advanced.reset') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';

import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '@iki/core/types/config';
import { formatLabel } from './settings_formatters';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const formatAdvancedLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    debugMode: t('settings.advanced.debugMode'),
    developerMode: t('settings.advanced.developerMode'),
    enableExperimentalFeatures: t('settings.advanced.experimental'),
  };

  return translatedLabels[key] || formatLabel(key);
};

const updateAdvanced = <K extends keyof AppConfig['advanced']>(
  key: K,
  value: AppConfig['advanced'][K]
) => {
  configStore.updateAdvanced(key, value);
  emit('config-change');
};
</script>

<style scoped src="./settings_shared.css"></style>
