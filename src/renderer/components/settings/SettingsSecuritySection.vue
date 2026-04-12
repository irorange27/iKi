<template>
  <section class="config-section">
    <div class="config-group">
      <h3>{{ t('settings.security.dataProtection') }}</h3>
      <label
        v-for="key in ['encryptApikeys', 'requirePassword'] as const"
        :key="key"
        class="checkbox-label"
      >
        <input
          type="checkbox"
          :checked="config.security[key]"
          @change="updateSecurity(key, ($event.target as HTMLInputElement).checked)"
        />
        {{ formatSecurityLabel(key) }}
      </label>
    </div>

    <div class="config-group">
      <h3>{{ t('settings.security.sessionTimeout') }}</h3>
      <div class="slider-field">
        <span>{{ t('settings.security.minutes') }}</span>
        <span class="value-badge">{{ config.security.sessionTimeout }}</span>
      </div>
      <input
        type="range"
        min="5"
        max="240"
        step="5"
        :value="config.security.sessionTimeout"
        @input="updateSecurity('sessionTimeout', getRangeValue($event))"
      />
      <p class="slider-hint">{{ t('settings.security.timeoutHint') }}</p>
    </div>

    <div class="config-group">
      <h3>{{ t('settings.security.logging') }}</h3>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.security.enableLogging"
          @change="updateSecurity('enableLogging', getCheckedValue($event))"
        />
        {{ t('settings.security.enableLogging') }}
      </label>
      <div v-if="config.security.enableLogging" class="input-label">
        <span>{{ t('settings.security.level') }}</span>
        <SettingsSelect
          class="security-log-level-select"
          :model-value="config.security.logLevel"
          :options="securityLogLevelOptions"
          :aria-label="t('settings.security.levelAria')"
          @update:model-value="updateSecurityLogLevelSelection"
        />
      </div>
    </div>

    <button class="reset-btn" @click="emit('reset')">
      {{ t('settings.security.reset') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '../../../shared/types/config';
import { formatLabel } from './settings_formatters';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const securityLogLevelOptions = computed(() => [
  { value: 'error', label: t('settings.security.logLevel.error') },
  { value: 'warn', label: t('settings.security.logLevel.warn') },
  { value: 'info', label: t('settings.security.logLevel.info') },
  { value: 'debug', label: t('settings.security.logLevel.debug') },
]);

const getCheckedValue = (event: Event): boolean =>
  (event.target as HTMLInputElement | null)?.checked ?? false;

const getRangeValue = (event: Event): number =>
  Number.parseInt((event.target as HTMLInputElement | null)?.value || '0', 10);

const formatSecurityLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    encryptApikeys: t('settings.security.encryptApiKeys'),
    requirePassword: t('settings.security.requirePassword'),
  };

  return translatedLabels[key] || formatLabel(key);
};

const updateSecurity = <K extends keyof AppConfig['security']>(
  key: K,
  value: AppConfig['security'][K]
) => {
  configStore.updateSecurity(key, value);
  emit('config-change');
};

const updateSecurityLogLevelSelection = (value: string) => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    updateSecurity('logLevel', value);
  }
};
</script>

<style scoped src="./settings_shared.css"></style>
