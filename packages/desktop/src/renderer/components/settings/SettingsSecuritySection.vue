<template>
  <section class="config-section">
    <div class="config-group">
      <h3>{{ t('settings.security.dataProtection') }}</h3>
      <SettingsSwitch
        v-for="key in ['encryptApikeys', 'requirePassword'] as const"
        :key="key"
        :model-value="config.security[key]"
        :title="formatSecurityLabel(key)"
        @update:model-value="updateSecurity(key, $event)"
      />
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
      <SettingsSwitch
        :model-value="config.security.enableLogging"
        :title="t('settings.security.enableLogging')"
        @update:model-value="updateSecurity('enableLogging', $event)"
      />
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
import SettingsSwitch from './SettingsSwitch.vue';
import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '@iki/backend/types/config';
import { formatLabel } from './settings_formatters';

const emit = defineEmits<{
  'config-change': [];
  reset: [];
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
