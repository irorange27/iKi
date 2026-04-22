<template>
  <section class="config-section bridges-section">
    <div class="config-group">
      <h3>{{ t('settings.napcat.title') }}</h3>
      <p class="group-description">{{ t('settings.napcat.description') }}</p>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="napcat.enabled"
          @change="updateNapCat('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.napcat.enable') }}
      </label>

      <label class="input-label">
        <span>{{ t('settings.napcat.accessTokenOptional') }}</span>
        <input
          type="password"
          :value="napcat.accessToken"
          :placeholder="t('settings.napcat.accessTokenPlaceholder')"
          @input="updateNapCat('accessToken', ($event.target as HTMLInputElement).value)"
        />
        <small class="input-help">
          {{ t('settings.napcat.accessTokenHelp') }}
        </small>
      </label>

      <div class="config-inline">
        <label class="input-label">
          <span>{{ t('settings.napcat.daemonHost') }}</span>
          <input
            type="text"
            :value="daemonHost"
            :placeholder="t('settings.napcat.daemonHostPlaceholder')"
            @input="updateDaemonHost(($event.target as HTMLInputElement).value)"
          />
          <small class="input-help">
            {{ t('settings.napcat.daemonHostHelp') }}
          </small>
        </label>

        <label class="input-label">
          <span>{{ t('settings.napcat.daemonPort') }}</span>
          <input
            type="number"
            min="1"
            max="65535"
            :value="daemonPort"
            :placeholder="t('settings.napcat.daemonPortPlaceholder')"
            @input="updateDaemonPort(($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <p class="group-description">{{ t('settings.napcat.daemonRestartNotice') }}</p>

      <div class="config-inline">
        <label class="input-label">
          <span>{{ t('settings.napcat.providerType') }}</span>
          <SettingsSelect
            :model-value="napcat.providerType"
            :options="napCatProviderTypeOptions"
            :aria-label="t('settings.napcat.providerTypeAria')"
            @update:model-value="updateNapCatProviderTypeSelection"
          />
        </label>

        <label class="input-label">
          <span>{{ t('common.model') }}</span>
          <input
            list="napcat-model-options"
            type="text"
            :value="napcat.model"
            :placeholder="t('settings.napcat.modelPlaceholder')"
            @input="updateNapCat('model', ($event.target as HTMLInputElement).value)"
          />
          <datalist id="napcat-model-options">
            <option v-for="model in selectedProviderModels" :key="model" :value="model" />
          </datalist>
        </label>
      </div>

      <p v-if="providersLoading" class="group-description">{{ t('settings.napcat.loadingProviders') }}</p>
      <p v-else-if="providersError" class="error-text">{{ providersError }}</p>
      <p v-else-if="providerOptions.length === 0" class="group-description warning-text">
        {{ t('settings.napcat.noProviders') }}
      </p>
      <p v-else-if="hasDuplicateProviderType" class="group-description warning-text">
        {{ t('settings.napcat.duplicateProviderType') }}
      </p>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="napcat.requireMention"
          @change="updateNapCat('requireMention', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.napcat.requireMention') }}
      </label>

      <label class="input-label">
        <span>{{ t('settings.napcat.allowedTools') }}</span>
        <textarea
          :value="toolListText"
          rows="4"
          :placeholder="t('settings.napcat.toolsPlaceholder')"
          @input="updateTools(($event.target as HTMLTextAreaElement).value)"
        />
        <small class="input-help">{{ t('settings.napcat.toolsHelp') }}</small>
      </label>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ t('settings.napcat.connectionTitle') }}</div>
          <div class="card-subtitle">{{ t('settings.napcat.connectionDescription') }}</div>
        </div>
        <div class="card-actions">
          <button
            class="reset-btn"
            type="button"
            :disabled="daemonControlLoading"
            @click="handleDaemonControl('start')"
          >
            {{ t('common.start') }}
          </button>
          <button
            class="reset-btn"
            type="button"
            :disabled="daemonControlLoading"
            @click="handleDaemonControl('restart')"
          >
            {{ t('common.restart') }}
          </button>
          <button
            class="reset-btn"
            type="button"
            :disabled="daemonControlLoading"
            @click="handleDaemonControl('stop')"
          >
            {{ t('common.stop') }}
          </button>
          <button class="reset-btn" type="button" @click="loadDaemonStatus">
            {{ t('settings.napcat.refreshStatus') }}
          </button>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">{{ t('common.status') }}</span>
          <span class="status-chip" :class="{ active: napcat.enabled }">
            {{ napcat.enabled ? t('common.enabled') : t('common.disabled') }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.daemonLabel') }}</span>
          <span class="status-chip" :class="daemonStatusClass">
            {{ daemonStatusChip }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.transportLabel') }}</span>
          <span class="status-chip" :class="transportStatusClass">
            {{ transportStatusChip }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.heartbeatLabel') }}</span>
          <span class="status-chip" :class="heartbeatStatusClass">
            {{ heartbeatStatusChip }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.activeConnections') }}</span>
          <span>{{ bridgeConnectionCount }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.lastHeartbeatLabel') }}</span>
          <span>{{ lastHeartbeatSummary }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.connectionDiagnosisLabel') }}</span>
          <span>{{ connectionDiagnosis }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.listening') }}</span>
          <code class="summary-code">{{ activeDaemonAddress }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.endpoint') }}</span>
          <code class="summary-code">ws://{{ activeDaemonAddress }}/onebot/v11/ws</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.authentication') }}</span>
          <span>{{
            napcat.accessToken.trim()
              ? t('settings.napcat.authRequired')
              : t('settings.napcat.authNone')
          }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('common.provider') }}</span>
          <span>{{ providerSummary }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.toolsLabel') }}</span>
          <span>{{ toolSummary }}</span>
        </div>
      </div>

      <p class="group-description">{{ daemonStatusDetail }}</p>
      <p class="group-description">{{ transportStatusDetail }}</p>
      <p class="group-description">{{ heartbeatStatusDetail }}</p>
      <p
        v-if="daemonControlMessage"
        class="group-description"
        :class="daemonControlSuccess === false ? 'error-text' : ''"
      >
        {{ daemonControlMessage }}
      </p>
      <p class="group-description">{{ t('settings.napcat.embeddedOnly') }}</p>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ t('settings.napcat.runtimePathsTitle') }}</div>
          <div class="card-subtitle">{{ t('settings.napcat.runtimePathsDescription') }}</div>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.configDb') }}</span>
          <code class="summary-code">{{ configPathSummary }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.localUrl') }}</span>
          <code class="summary-code">{{ localWsUrl }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.dockerUrl') }}</span>
          <code class="summary-code">{{ dockerWsUrl }}</code>
        </div>
      </div>

      <p class="group-description">{{ t('settings.napcat.runtimePathsHelp') }}</p>
      <p v-if="runtimeInfoError" class="error-text">{{ runtimeInfoError }}</p>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ t('settings.napcat.recentLogsTitle') }}</div>
          <div class="card-subtitle">{{ t('settings.napcat.recentLogsDescription') }}</div>
        </div>
        <div class="card-actions">
          <button class="reset-btn" type="button" @click="loadDaemonLogs">
            {{ t('settings.napcat.refreshLogs') }}
          </button>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.logFile') }}</span>
          <code class="summary-code">{{ daemonLogPath }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.entries') }}</span>
          <span>{{ daemonLogCount }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">{{ t('settings.napcat.qqMessages') }}</span>
          <span>{{ napcatMessagePreviewCount }}</span>
        </div>
      </div>

      <pre class="log-view">{{ daemonLogText }}</pre>
      <p v-if="daemonLogsError" class="error-text">{{ daemonLogsError }}</p>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.napcat.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { toRef } from 'vue';

import SettingsSelect from './SettingsSelect.vue';
import { useNapCatSettings } from '../../composables/useNapCatSettings';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();
const props = defineProps<{
  active: boolean;
}>();
const {
  activeDaemonAddress,
  bridgeConnectionCount,
  connectionDiagnosis,
  configPathSummary,
  daemonControlLoading,
  daemonControlMessage,
  daemonControlSuccess,
  daemonHost,
  daemonLogCount,
  daemonLogPath,
  daemonLogText,
  daemonLogsError,
  daemonPort,
  daemonStatusChip,
  daemonStatusClass,
  daemonStatusDetail,
  dockerWsUrl,
  handleDaemonControl,
  hasDuplicateProviderType,
  heartbeatStatusChip,
  heartbeatStatusClass,
  heartbeatStatusDetail,
  lastHeartbeatSummary,
  loadDaemonLogs,
  loadDaemonStatus,
  localWsUrl,
  napCatProviderTypeOptions,
  napcat,
  napcatMessagePreviewCount,
  providerOptions,
  providerSummary,
  providersError,
  providersLoading,
  runtimeInfoError,
  selectedProviderModels,
  t,
  toolListText,
  toolSummary,
  transportStatusChip,
  transportStatusClass,
  transportStatusDetail,
  updateDaemonHost,
  updateDaemonPort,
  updateNapCat,
  updateNapCatProviderTypeSelection,
  updateTools,
} = useNapCatSettings({
  active: toRef(props, 'active'),
  onConfigChange: () => emit('config-change'),
});
</script>

<style scoped src="./settings_shared.css"></style>
<style scoped src="./settings_napcat.css"></style>
