<template>
  <!-- A dev row is a BOOLEAN-ish action, so it is a row: label left, action
       right, one trailing hairline — the same grammar as SettingsSwitch rows.
       Hidden entirely in a packaged build, where nothing here applies. -->
  <div v-if="status?.available" class="config-group dev-restart-row">
    <div class="dev-restart-text">
      <h3>{{ t('dev.restart.title') }}</h3>
      <p class="dev-restart-hint">
        {{ status.hotReload ? t('dev.restart.hot') : t('dev.restart.noHot') }}
      </p>
    </div>
    <button type="button" class="dev-restart-btn" :disabled="restarting" @click="restart">
      {{ restarting ? t('dev.restart.coming') : t('dev.restart.action') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { DevRuntimeStatus } from '@iki/backend/types/devtools';
import { useI18n } from '../../i18n';
import { getElectronAPI } from '../../services/electron_api';

const { t } = useI18n();
const electronAPI = getElectronAPI();
const status = ref<DevRuntimeStatus | null>(null);
const restarting = ref(false);

onMounted(async () => {
  try {
    status.value = await electronAPI.dev.getStatus();
  } catch {
    status.value = null;
  }
});

const restart = async () => {
  if (restarting.value) return;
  restarting.value = true;
  try {
    await electronAPI.dev.restartApp();
  } catch {
    restarting.value = false;
  }
};
</script>

<style scoped>
.dev-restart-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.dev-restart-text h3 {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.dev-restart-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  max-width: 520px;
}

.dev-restart-btn {
  flex: none;
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s,
    background 0.2s;
}

.dev-restart-btn:hover:not(:disabled) {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: var(--bg-hover);
}

.dev-restart-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
