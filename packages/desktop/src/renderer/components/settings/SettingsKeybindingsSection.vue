<template>
  <section class="config-section">
    <div class="config-group">
      <label v-for="(value, key) in config.keybindings" :key="key" class="input-label">
        {{ formatKeybindingLabel(key) }}:
        <input type="text" :value="value" @input="updateKeybinding(key, getInputValue($event))" />
      </label>
    </div>

    <button class="reset-btn" @click="emit('reset')">
      {{ t('settings.keybindings.reset') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';

import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '@iki/backend/types/config';
import { formatLabel } from './settings_formatters';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const getInputValue = (event: Event): string =>
  (event.target as HTMLInputElement | null)?.value ?? '';

const formatKeybindingLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    sendMessage: t('settings.keybindings.sendMessage'),
    openSettings: t('settings.keybindings.openSettings'),
  };

  return translatedLabels[key] || formatLabel(key);
};

const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
  configStore.updateKeybinding(key, value);
  emit('config-change');
};
</script>

<style scoped src="./settings_shared.css"></style>
