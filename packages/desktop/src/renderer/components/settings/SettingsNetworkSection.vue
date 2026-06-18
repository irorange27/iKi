<template>
  <section class="config-section">
    <div class="config-group">
      <div class="card-header">
        <div>
          <h3>{{ t('settings.network.webSearch.title') }}</h3>
          <p class="group-description">{{ t('settings.network.webSearch.description') }}</p>
        </div>
      </div>

      <label class="input-label">
        <span>{{ t('settings.network.webSearch.engine') }}</span>
        <SettingsSelect
          class="network-web-search-select"
          :model-value="config.network.webSearch.preferredEngine"
          :options="webSearchEngineOptions"
          :aria-label="t('settings.network.webSearch.engineAria')"
          @update:model-value="updateWebSearchEngineSelection"
        />
      </label>

      <p class="card-help">{{ t('settings.network.webSearch.fallbackHint') }}</p>
    </div>

    <div class="config-group">
      <div class="card-header">
        <div>
          <h3>{{ t('settings.network.proxy.title') }}</h3>
          <p class="group-description">{{ t('settings.network.proxy.description') }}</p>
        </div>
        <span class="network-summary-pill">{{ proxySummary }}</span>
      </div>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.network.proxy.enable"
          @change="updateProxy('enable', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.network.proxy.enable') }}
      </label>

      <div v-if="config.network.proxy.enable" class="config-grid">
        <label class="input-label">
          <span>{{ t('settings.network.proxy.type') }}</span>
          <SettingsSelect
            class="network-proxy-type-select"
            :model-value="config.network.proxy.type"
            :options="proxyTypeOptions"
            :aria-label="t('settings.network.proxy.typeAria')"
            @update:model-value="updateProxyTypeSelection"
          />
        </label>

        <label class="input-label">
          <span>{{ t('settings.network.proxy.host') }}</span>
          <input
            type="text"
            :value="config.network.proxy.host"
            :placeholder="t('settings.network.proxy.hostPlaceholder')"
            @input="updateProxy('host', getInputValue($event))"
          />
        </label>

        <label class="input-label">
          <span>{{ t('settings.network.proxy.port') }}</span>
          <input
            type="number"
            min="1"
            max="65535"
            :value="config.network.proxy.port ?? ''"
            :placeholder="t('settings.network.proxy.portPlaceholder')"
            @input="updateProxy('port', parseOptionalInteger(getInputValue($event)))"
          />
        </label>

        <label class="input-label">
          <span>{{ t('settings.network.proxy.usernameOptional') }}</span>
          <input
            type="text"
            :value="config.network.proxy.username ?? ''"
            :placeholder="t('settings.network.proxy.usernamePlaceholder')"
            @input="updateProxy('username', getInputValue($event))"
          />
        </label>

        <label class="input-label">
          <span>{{ t('settings.network.proxy.passwordOptional') }}</span>
          <input
            type="password"
            :value="config.network.proxy.password ?? ''"
            :placeholder="t('settings.network.proxy.passwordPlaceholder')"
            @input="updateProxy('password', getInputValue($event))"
          />
        </label>
      </div>

      <p v-if="config.network.proxy.enable" class="card-help">
        {{ t('settings.network.proxy.authHint') }}
      </p>
    </div>

    <div class="config-group">
      <div class="card-header">
        <div>
          <h3>{{ t('settings.network.diagnostics.title') }}</h3>
          <p class="group-description">{{ t('settings.network.diagnostics.description') }}</p>
        </div>
        <button
          type="button"
          class="secondary-btn network-test-btn"
          :disabled="!canTestNetwork"
          @click="runNetworkTest"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': isTesting }" />
          {{
            isTesting
              ? t('settings.network.diagnostics.testing')
              : t('settings.network.diagnostics.testAction')
          }}
        </button>
      </div>

      <p class="card-help">{{ t('settings.network.diagnostics.usesDraft') }}</p>
      <p v-if="proxyValidationError" class="tasks-error">{{ proxyValidationError }}</p>

      <div v-if="diagnostic" class="network-diagnostic-summary" :class="summaryToneClass">
        <div class="network-diagnostic-summary-title">{{ summaryTitle }}</div>
        <div class="network-diagnostic-summary-body">{{ summaryBody }}</div>
      </div>

      <div v-if="diagnostic?.results.length" class="network-probe-list">
        <article
          v-for="probe in diagnostic.results"
          :key="probe.key"
          class="network-probe-card"
          :class="{ 'is-success': probe.success, 'is-error': !probe.success }"
        >
          <div class="network-probe-header">
            <div class="network-probe-copy">
              <div class="network-probe-title">{{ getProbeLabel(probe.key) }}</div>
              <div class="network-probe-url">{{ probe.url }}</div>
            </div>
            <span class="network-probe-status">
              {{ probe.success ? t('settings.network.diagnostics.reachable') : t('common.error') }}
            </span>
          </div>
          <div class="network-probe-meta">
            <span>{{ getProbeStatusDetail(probe) }}</span>
            <span>{{ t('settings.network.diagnostics.duration', { ms: probe.durationMs }) }}</span>
            <span v-if="probe.resolvedProxy">
              {{ t('settings.network.diagnostics.route', { route: probe.resolvedProxy }) }}
            </span>
          </div>
        </article>
      </div>
    </div>

    <div class="config-group">
      <h3>{{ t('settings.network.timeoutRetryTitle') }}</h3>

      <div class="slider-field">
        <span>{{ t('settings.network.timeoutMs') }}</span>
        <span class="network-value-badge">{{ config.network.timeout }}</span>
      </div>
      <input
        type="range"
        min="1000"
        max="20000"
        step="500"
        :value="config.network.timeout"
        @input="updateNetwork('timeout', parseRequiredInteger(getInputValue($event)))"
      />
      <p class="slider-hint">{{ t('settings.network.timeoutHint') }}</p>

      <div class="slider-field">
        <span>{{ t('settings.network.retryAttempts') }}</span>
        <span class="network-value-badge">{{ config.network.retryAttempts }}</span>
      </div>
      <input
        type="range"
        min="0"
        max="10"
        step="1"
        :value="config.network.retryAttempts"
        @input="updateNetwork('retryAttempts', parseRequiredInteger(getInputValue($event)))"
      />
      <p class="slider-hint">{{ t('settings.network.retryHint') }}</p>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.network.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { RefreshCw } from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import { configService } from '../../services/config_service';
import { clonePlainData } from '@iki/core/utils/clone';
import type {
  AppConfig,
  NetworkDiagnosticProbeResult,
  NetworkDiagnosticResult,
  NetworkDiagnosticTargetKey,
  WebSearchEngine,
} from '@iki/core/types/config';
import { buildProxyUrl } from '@iki/backend/network/proxy';
import { getErrorMessage } from '@iki/core/utils/errors';

defineProps<{
  active?: boolean;
}>();

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const isTesting = ref(false);
const diagnostic = ref<NetworkDiagnosticResult | null>(null);

const proxyTypeOptions = computed(() => [
  { value: 'http', label: t('settings.network.proxy.http') },
  { value: 'https', label: t('settings.network.proxy.https') },
  { value: 'socks5', label: t('settings.network.proxy.socks5') },
]);

const getSearchEngineLabel = (engine: WebSearchEngine): string => {
  if (engine === 'duckduckgo') return t('settings.network.webSearch.duckduckgo');
  if (engine === 'bing') return t('settings.network.webSearch.bing');
  return t('settings.network.webSearch.google');
};

const webSearchEngineOptions = computed(() => [
  { value: 'google', label: getSearchEngineLabel('google') },
  { value: 'duckduckgo', label: getSearchEngineLabel('duckduckgo') },
  { value: 'bing', label: getSearchEngineLabel('bing') },
]);

const getInputValue = (event: Event): string =>
  (event.target as HTMLInputElement | null)?.value ?? '';

const parseRequiredInteger = (value: string): number => Number.parseInt(value || '0', 10);

const parseOptionalInteger = (value: string): number | null =>
  value ? Number.parseInt(value, 10) : null;

const clearDiagnostic = (): void => {
  diagnostic.value = null;
};

const emitConfigChange = (): void => {
  clearDiagnostic();
  emit('config-change');
};

const updateNetwork = <K extends Exclude<keyof AppConfig['network'], 'proxy' | 'webSearch'>>(
  key: K,
  value: AppConfig['network'][K]
) => {
  configStore.updateNetwork(key, value);
  emitConfigChange();
};

const updateProxy = <K extends keyof AppConfig['network']['proxy']>(
  key: K,
  value: AppConfig['network']['proxy'][K]
) => {
  configStore.updateNetworkProxy(key, value);
  emitConfigChange();
};

const updateWebSearch = <K extends keyof AppConfig['network']['webSearch']>(
  key: K,
  value: AppConfig['network']['webSearch'][K]
) => {
  configStore.updateNetworkWebSearch(key, value);
  emitConfigChange();
};

const updateProxyTypeSelection = (value: string) => {
  if (value === 'http' || value === 'https' || value === 'socks5') {
    updateProxy('type', value);
  }
};

const updateWebSearchEngineSelection = (value: string) => {
  if (value === 'google' || value === 'duckduckgo' || value === 'bing') {
    updateWebSearch('preferredEngine', value);
  }
};

const proxyValidationError = computed(() => {
  if (!config.value.network.proxy.enable) return '';

  if (!config.value.network.proxy.host.trim()) {
    return t('settings.network.proxy.validationHost');
  }

  const port = config.value.network.proxy.port;
  if (!Number.isFinite(port) || Math.trunc(port) < 1 || Math.trunc(port) > 65535) {
    return t('settings.network.proxy.validationPort');
  }

  return '';
});

const proxySummary = computed(() => {
  if (!config.value.network.proxy.enable) {
    return t('settings.network.proxy.summaryDirect');
  }

  const proxyUrl = buildProxyUrl(config.value.network, { includeAuth: false });
  if (!proxyUrl) {
    return t('settings.network.proxy.summaryIncomplete');
  }

  return proxyUrl;
});

const passedCount = computed(() => diagnostic.value?.results.filter(result => result.success).length ?? 0);
const totalCount = computed(() => diagnostic.value?.results.length ?? 0);

const summaryTone = computed<'success' | 'warning' | 'error'>(() => {
  if (!diagnostic.value) return 'error';
  if (diagnostic.value.success) return 'success';
  if (passedCount.value > 0) return 'warning';
  return 'error';
});

const summaryToneClass = computed(() => `is-${summaryTone.value}`);

const summaryTitle = computed(() => {
  if (!diagnostic.value) return '';
  if (diagnostic.value.success) return t('settings.network.diagnostics.successTitle');
  if (passedCount.value > 0) return t('settings.network.diagnostics.partialTitle');
  return t('settings.network.diagnostics.failedTitle');
});

const summaryBody = computed(() => {
  if (!diagnostic.value) return '';
  if (diagnostic.value.error) return diagnostic.value.error;

  const route = diagnostic.value.effectiveProxy
    ? t('settings.network.diagnostics.routeProxy', {
        proxy: diagnostic.value.effectiveProxy,
      })
    : t('settings.network.diagnostics.routeDirect');

  if (diagnostic.value.success) {
    return t('settings.network.diagnostics.summaryAllPassed', {
      passed: passedCount.value,
      total: totalCount.value,
      route,
    });
  }

  if (passedCount.value > 0) {
    return t('settings.network.diagnostics.summaryPartial', {
      passed: passedCount.value,
      total: totalCount.value,
      route,
    });
  }

  return t('settings.network.diagnostics.summaryNonePassed', {
    route,
  });
});

const canTestNetwork = computed(() => !isTesting.value && !proxyValidationError.value);

const getProbeLabel = (key: NetworkDiagnosticTargetKey): string => {
  if (key === 'searchEngine') {
    return t('settings.network.diagnostics.targetSearchEngine', {
      engine: getSearchEngineLabel(config.value.network.webSearch.preferredEngine),
    });
  }
  return t('settings.network.diagnostics.targetInternet');
};

const getProbeStatusDetail = (probe: NetworkDiagnosticProbeResult): string => {
  if (probe.error) return probe.error;
  if (typeof probe.statusCode === 'number') {
    return t('settings.network.diagnostics.statusCode', {
      code: probe.statusCode,
    });
  }
  return t('common.unknown');
};

const runNetworkTest = async () => {
  if (!canTestNetwork.value) return;

  isTesting.value = true;
  clearDiagnostic();

  try {
    diagnostic.value = await configService.testNetwork(clonePlainData(config.value.network));
  } catch (error) {
    diagnostic.value = {
      success: false,
      testedAt: new Date().toISOString(),
      effectiveProxy: buildProxyUrl(config.value.network, { maskPassword: true }),
      error: getErrorMessage(error),
      results: [],
    };
  } finally {
    isTesting.value = false;
  }
};
</script>

<style scoped src="./settings_shared.css"></style>
<style scoped>
.network-summary-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  max-width: min(100%, 320px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-test-btn {
  flex-shrink: 0;
}

.network-diagnostic-summary {
  margin-top: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--surface-radius);
  padding: 14px 16px;
  background: var(--bg-secondary);
}

.network-diagnostic-summary.is-success {
  border-color: color-mix(in srgb, var(--success-color) 38%, var(--border-color));
  background: color-mix(in srgb, var(--success-color) 10%, var(--bg-secondary));
}

.network-diagnostic-summary.is-warning {
  border-color: color-mix(in srgb, var(--warning-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--warning-color) 10%, var(--bg-secondary));
}

.network-diagnostic-summary.is-error {
  border-color: color-mix(in srgb, var(--danger-color) 35%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 8%, var(--bg-secondary));
}

.network-diagnostic-summary-title {
  font-weight: 600;
  color: var(--text-primary);
}

.network-diagnostic-summary-body {
  margin-top: 6px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.network-probe-list {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.network-probe-card {
  border: 1px solid var(--border-color);
  border-radius: var(--control-radius);
  padding: 14px 16px;
  background: var(--bg-secondary);
}

.network-probe-card.is-success {
  border-color: color-mix(in srgb, var(--success-color) 34%, var(--border-color));
}

.network-probe-card.is-error {
  border-color: color-mix(in srgb, var(--danger-color) 34%, var(--border-color));
}

.network-probe-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.network-probe-copy {
  min-width: 0;
}

.network-probe-title {
  font-weight: 600;
  color: var(--text-primary);
}

.network-probe-url {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  word-break: break-all;
}

.network-probe-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.network-probe-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.network-value-badge {
  background: var(--bg-active);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.875em;
}

@media (max-width: 840px) {
  .network-summary-pill {
    max-width: 100%;
  }

  .network-probe-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
