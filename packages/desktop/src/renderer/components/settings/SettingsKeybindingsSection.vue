<template>
  <section class="config-section">
    <div class="config-group">
      <div v-for="(value, key) in config.keybindings" :key="key" class="keybinding-row">
        <span class="keybinding-label">{{ formatKeybindingLabel(key) }}</span>
        <input
          class="keybinding-input"
          type="text"
          :value="value"
          :aria-label="formatKeybindingLabel(key)"
          @input="updateKeybinding(key, getInputValue($event))"
        />
      </div>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.keybindings.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';

import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '@iki/core/types/config';
import { formatLabel } from './settings_formatters';

const emit = defineEmits<{
  'config-change': [];
  reset: [];
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

<style scoped>
.keybinding-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 32%, transparent);
}

.keybinding-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.keybinding-label {
  font-size: 13px;
  color: var(--text-primary);
}

.keybinding-input {
  width: 160px;
  height: 30px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 62%, transparent);
  border-radius: var(--control-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: center;
}

.keybinding-input:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 18%, transparent);
}
</style>
