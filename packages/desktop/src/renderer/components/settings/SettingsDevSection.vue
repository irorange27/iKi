<template>
  <!-- Hidden entirely in a packaged build, where nothing here applies. -->
  <div v-if="status?.available" class="config-group dev-restart-row">
    <div class="dev-restart-text">
      <h3>{{ t('dev.restart.title') }}</h3>
      <p class="dev-restart-hint">
        {{ status.hotReload ? t('dev.restart.hot') : t('dev.restart.noHot') }}
      </p>
    </div>
    <button type="button" class="secondary-btn" :disabled="restarting" @click="restart">
      {{ restarting ? t('dev.restart.coming') : t('dev.restart.action') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { DevRuntimeStatus } from '@iki/core/types/devtools';
import { useI18n } from '../../i18n';
import { useSettingsClient } from '../../services/settings_client';

const { t } = useI18n();
const settingsClient = useSettingsClient();
const status = ref<DevRuntimeStatus | null>(null);
const restarting = ref(false);

onMounted(async () => {
  try {
    status.value = await settingsClient.dev.getStatus();
  } catch {
    status.value = null;
  }
});

const restart = async () => {
  if (restarting.value) return;
  restarting.value = true;
  try {
    await settingsClient.dev.restartApp();
  } catch {
    restarting.value = false;
  }
};
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.dev-restart-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
  color: var(--text-muted);
  max-width: 520px;
}
</style>
