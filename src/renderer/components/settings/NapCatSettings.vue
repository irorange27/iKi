<template>
  <section class="config-section bridges-section">
    <div class="config-group">
      <h3>NapCat (QQ)</h3>
      <p class="group-description">
        Configure the reverse WebSocket bridge exposed by the daemon at path
        <code>/onebot/v11/ws</code>. If NapCat runs in Docker, use a host-reachable daemon address
        instead of <code>localhost</code>.
      </p>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="napcat.enabled"
          @change="updateNapCat('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable NapCat reverse WebSocket bridge
      </label>

      <label class="input-label">
        <span>Access Token (optional)</span>
        <input
          type="password"
          :value="napcat.accessToken"
          placeholder="Leave empty to disable bridge auth"
          @input="updateNapCat('accessToken', ($event.target as HTMLInputElement).value)"
        />
        <small class="input-help">
          If set, NapCat must connect with <code>?access_token=...</code>.
        </small>
      </label>

      <div class="config-inline">
        <label class="input-label">
          <span>Daemon Host</span>
          <input
            type="text"
            :value="daemonHost"
            placeholder="127.0.0.1"
            @input="updateDaemonHost(($event.target as HTMLInputElement).value)"
          />
        <small class="input-help">
          Defaults to <code>127.0.0.1</code>. Use <code>0.0.0.0</code> only when you intentionally
          need LAN/Docker access.
        </small>
      </label>

        <label class="input-label">
          <span>Daemon Port</span>
          <input
            type="number"
            min="1"
            max="65535"
            :value="daemonPort"
            placeholder="6127"
            @input="updateDaemonPort(($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <p class="group-description">
        Changing daemon host/port will restart the desktop-managed daemon after saving settings.
      </p>

      <div class="config-inline">
        <label class="input-label">
          <span>Provider Type</span>
          <select
            :value="napcat.providerType"
            @change="updateNapCat('providerType', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Auto-select first enabled provider</option>
            <option v-for="provider in providerOptions" :key="provider.type" :value="provider.type">
              {{ provider.label }}
            </option>
          </select>
        </label>

        <label class="input-label">
          <span>Model</span>
          <input
            list="napcat-model-options"
            type="text"
            :value="napcat.model"
            placeholder="Leave empty to use the provider default"
            @input="updateNapCat('model', ($event.target as HTMLInputElement).value)"
          />
          <datalist id="napcat-model-options">
            <option v-for="model in selectedProviderModels" :key="model" :value="model" />
          </datalist>
        </label>
      </div>

      <p v-if="providersLoading" class="group-description">Loading enabled providers...</p>
      <p v-else-if="providersError" class="error-text">{{ providersError }}</p>
      <p v-else-if="providerOptions.length === 0" class="group-description warning-text">
        No enabled providers with model metadata are available. The bridge will not be able to
        generate replies until at least one provider is configured.
      </p>
      <p v-else-if="hasDuplicateProviderType" class="group-description warning-text">
        Multiple enabled providers share the same type. The bridge currently uses the first enabled
        provider for that type.
      </p>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="napcat.requireMention"
          @change="updateNapCat('requireMention', ($event.target as HTMLInputElement).checked)"
        />
        Require @mention in group chats before replying
      </label>

      <label class="input-label">
        <span>Allowed Tools (one per line)</span>
        <textarea
          :value="toolListText"
          rows="4"
          placeholder="web&#10;fetch"
          @input="updateTools(($event.target as HTMLTextAreaElement).value)"
        />
        <small class="input-help">Leave empty to disable tool use for QQ replies.</small>
      </label>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">Connection Summary</div>
          <div class="card-subtitle">
            What NapCat needs to connect successfully. Auto-refreshes every 5s while open.
          </div>
        </div>
        <div class="card-actions">
          <button
            class="reset-btn"
            type="button"
            :disabled="daemonControlLoading"
            @click="handleDaemonControl('start')"
          >
            Start
          </button>
          <button
            class="reset-btn"
            type="button"
            :disabled="daemonControlLoading"
            @click="handleDaemonControl('restart')"
          >
            Restart
          </button>
          <button
            class="reset-btn"
            type="button"
            :disabled="daemonControlLoading"
            @click="handleDaemonControl('stop')"
          >
            Stop
          </button>
          <button class="reset-btn" type="button" @click="loadDaemonStatus">Refresh Status</button>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">Status</span>
          <span class="status-chip" :class="{ active: napcat.enabled }">
            {{ napcat.enabled ? 'Enabled' : 'Disabled' }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Daemon</span>
          <span class="status-chip" :class="daemonStatusClass">
            {{ daemonStatusChip }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Listening</span>
          <code class="summary-code">{{ activeDaemonAddress }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">Endpoint</span>
          <code class="summary-code">ws://{{ activeDaemonAddress }}/onebot/v11/ws</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">Authentication</span>
          <span>{{
            napcat.accessToken.trim() ? 'Bearer token required' : 'No token required'
          }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Provider</span>
          <span>{{ providerSummary }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Tools</span>
          <span>{{ toolSummary }}</span>
        </div>
      </div>

      <p class="group-description">{{ daemonStatusDetail }}</p>
      <p
        v-if="daemonControlMessage"
        class="group-description"
        :class="daemonControlSuccess === false ? 'error-text' : ''"
      >
        {{ daemonControlMessage }}
      </p>
      <p class="group-description">
        These controls manage the desktop-managed embedded daemon only.
      </p>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">Runtime Paths</div>
          <div class="card-subtitle">The desktop app and daemon should read the same config DB</div>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">Config DB</span>
          <code class="summary-code">{{ configPathSummary }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">Local NapCat URL</span>
          <code class="summary-code">{{ localWsUrl }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">Docker NapCat URL</span>
          <code class="summary-code">{{ dockerWsUrl }}</code>
        </div>
      </div>

      <p class="group-description">
        When the URL already includes <code>access_token=...</code>, leave NapCat's separate
        <code>Token</code> field empty to avoid mixing two auth paths.
      </p>
      <p v-if="runtimeInfoError" class="error-text">{{ runtimeInfoError }}</p>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">Recent Logs</div>
          <div class="card-subtitle">
            Recent daemon and NapCat events for local debugging. Auto-refreshes every 5s while open.
          </div>
        </div>
        <div class="card-actions">
          <button class="reset-btn" type="button" @click="loadDaemonLogs">Refresh Logs</button>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">Log File</span>
          <code class="summary-code">{{ daemonLogPath }}</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">Entries</span>
          <span>{{ daemonLogCount }}</span>
        </div>
      </div>

      <pre class="log-view">{{ daemonLogText }}</pre>
      <p v-if="daemonLogsError" class="error-text">{{ daemonLogsError }}</p>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">Reset Bridges</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import { configService } from '../../services/config_service';
import { useConfigStore } from '../../store/config';
import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonLogsInfo,
  DaemonStatusInfo,
} from '../../../shared/types/config';
import type { Provider } from '../../../shared/types/provider';
import {
  buildNapCatWsUrl,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
} from '../../../shared/constants/daemon';
import { getErrorMessage } from '../../../shared/utils/errors';
import { parseModelList } from '../../../shared/utils/provider_models';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();
const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const props = defineProps<{
  active: boolean;
}>();

type ProviderOption = {
  type: string;
  label: string;
  models: string[];
  duplicateCount: number;
};

const MONITORING_POLL_MS = 5000;

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const providers = ref<Provider[]>([]);
const providersLoading = ref(false);
const providersError = ref('');
const runtimeInfo = ref<ConfigRuntimeInfo | null>(null);
const runtimeInfoError = ref('');
const daemonStatus = ref<DaemonStatusInfo | null>(null);
const daemonStatusLoading = ref(false);
const daemonStatusError = ref('');
const daemonLogs = ref<DaemonLogsInfo | null>(null);
const daemonLogsLoading = ref(false);
const daemonLogsError = ref('');
const daemonControlLoading = ref(false);
const daemonControlMessage = ref('');
const daemonControlSuccess = ref<boolean | null>(null);
let monitoringPollTimer: ReturnType<typeof setInterval> | null = null;

const napcat = computed(() => config.value.bridges.napcat);
const accessToken = computed(() => napcat.value.accessToken.trim());
const daemonHost = computed(() => {
  const host = config.value.daemon?.host;
  if (typeof host !== 'string' || !host.trim()) return DEFAULT_DAEMON_HOST;
  return host.trim();
});
const daemonPort = computed(() => {
  const port = Number(config.value.daemon?.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return DEFAULT_DAEMON_PORT;
  return Math.trunc(port);
});

const providerOptions = computed<ProviderOption[]>(() => {
  const byType = new Map<string, ProviderOption>();

  for (const provider of providers.value) {
    if (!provider.enabled) continue;
    const type = provider.type?.trim();
    if (!type) continue;

    const models = parseModelList(provider.models);
    if (models.length === 0) continue;

    const existing = byType.get(type);
    if (existing) {
      existing.duplicateCount += 1;
      continue;
    }

    byType.set(type, {
      type,
      label: `${provider.name} (${type})`,
      models,
      duplicateCount: 1,
    });
  }

  return Array.from(byType.values()).sort((a, b) => a.label.localeCompare(b.label));
});

const selectedProviderOption = computed(() => {
  const providerType = napcat.value.providerType?.trim();
  if (!providerType) return null;
  return providerOptions.value.find(option => option.type === providerType) || null;
});

const selectedProviderModels = computed(() => selectedProviderOption.value?.models || []);

const hasDuplicateProviderType = computed(() =>
  providerOptions.value.some(option => option.duplicateCount > 1)
);

const toolListText = computed(() => napcat.value.tools.join('\n'));

const providerSummary = computed(() => {
  const providerType = napcat.value.providerType?.trim();
  const model = napcat.value.model?.trim();

  if (!providerType && !model) return 'Auto-select first enabled provider and model';
  if (providerType && model) return `${providerType} / ${model}`;
  if (providerType) return `${providerType} / default model`;
  return `Auto-select provider / ${model}`;
});

const toolSummary = computed(() => {
  return napcat.value.tools.length > 0 ? napcat.value.tools.join(', ') : 'Disabled';
});

const configPathSummary = computed(() => runtimeInfo.value?.dbPath || 'Unavailable');
const daemonStatusChip = computed(() => {
  if (daemonStatusLoading.value) return 'Checking';
  if (daemonStatus.value?.online) return 'Online';
  return 'Offline';
});
const daemonStatusClass = computed(() => ({
  active: Boolean(daemonStatus.value?.online),
}));
const daemonStatusDetail = computed(() => {
  if (daemonStatusLoading.value) return 'Checking daemon health...';
  if (daemonStatusError.value) return daemonStatusError.value;
  if (!daemonStatus.value) return 'Daemon status unavailable.';
  if (daemonStatus.value.online && daemonStatus.value.uptimeSeconds !== null) {
    return `Uptime ${daemonStatus.value.uptimeSeconds.toFixed(0)}s`;
  }
  if (daemonStatus.value.error) return daemonStatus.value.error;
  return `Using ${daemonStatus.value.source} address information.`;
});
const activeDaemonHost = computed(() => daemonStatus.value?.host || daemonHost.value);
const activeDaemonPort = computed(() => daemonStatus.value?.port || daemonPort.value);
const activeDaemonAddress = computed(() => `${activeDaemonHost.value}:${activeDaemonPort.value}`);
const daemonLogPath = computed(() => daemonLogs.value?.filePath || 'Unavailable');
const daemonLogCount = computed(() => {
  if (daemonLogsLoading.value) return 'Loading...';
  return String(daemonLogs.value?.entries.length || 0);
});
const daemonLogText = computed(() => {
  if (daemonLogsLoading.value) return 'Loading daemon logs...';
  if (daemonLogsError.value) return daemonLogsError.value;
  const entries = daemonLogs.value?.entries || [];
  if (entries.length === 0) return 'No daemon logs available yet.';
  return entries
    .map(entry => `[${entry.timestamp}] [${entry.level}] [${entry.source}] ${entry.message}`)
    .join('\n');
});

const localWsUrl = computed(() =>
  buildNapCatWsUrl(activeDaemonHost.value, activeDaemonPort.value, accessToken.value)
);

const dockerWsUrl = computed(() =>
  buildNapCatWsUrl('host.docker.internal', activeDaemonPort.value, accessToken.value)
);

const updateNapCat = <K extends keyof AppConfig['bridges']['napcat']>(
  key: K,
  value: AppConfig['bridges']['napcat'][K]
) => {
  config.value.bridges.napcat[key] = value;
  emit('config-change');
};

const updateDaemonHost = (value: string) => {
  config.value.daemon.host = value;
  emit('config-change');
};

const updateDaemonPort = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    config.value.daemon.port = DEFAULT_DAEMON_PORT;
    emit('config-change');
    return;
  }
  config.value.daemon.port = Math.trunc(parsed);
  emit('config-change');
};

const updateTools = (value: string) => {
  const tools = value
    .split(/[\r\n,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
  updateNapCat('tools', tools);
};

const loadProviders = async () => {
  providersLoading.value = true;
  providersError.value = '';
  try {
    if (!electronAPI?.providers?.list) {
      providers.value = [];
      providersError.value = 'Provider API is unavailable.';
      return;
    }
    const list = await electronAPI.providers.list();
    providers.value = Array.isArray(list) ? (list as Provider[]) : [];
  } catch (error: unknown) {
    providers.value = [];
    providersError.value = getErrorMessage(error);
  } finally {
    providersLoading.value = false;
  }
};

const loadRuntimeInfo = async () => {
  runtimeInfoError.value = '';
  try {
    runtimeInfo.value = await configService.getRuntimeInfo();
  } catch (error: unknown) {
    runtimeInfo.value = null;
    runtimeInfoError.value = getErrorMessage(error);
  }
};

const loadDaemonStatus = async () => {
  if (daemonStatusLoading.value) return;
  daemonStatusLoading.value = true;
  daemonStatusError.value = '';
  try {
    daemonStatus.value = await configService.getDaemonStatus();
  } catch (error: unknown) {
    daemonStatus.value = null;
    daemonStatusError.value = getErrorMessage(error);
  } finally {
    daemonStatusLoading.value = false;
  }
};

const loadDaemonLogs = async () => {
  if (daemonLogsLoading.value) return;
  daemonLogsLoading.value = true;
  daemonLogsError.value = '';
  try {
    daemonLogs.value = await configService.getDaemonLogs(120);
  } catch (error: unknown) {
    daemonLogs.value = null;
    daemonLogsError.value = getErrorMessage(error);
  } finally {
    daemonLogsLoading.value = false;
  }
};

const handleDaemonControl = async (action: DaemonControlAction) => {
  if (daemonControlLoading.value) return;
  daemonControlLoading.value = true;
  daemonControlMessage.value = '';
  daemonControlSuccess.value = null;

  try {
    const result = await configService.controlDaemon(action);
    daemonStatus.value = result.status;
    daemonControlSuccess.value = result.success;
    daemonControlMessage.value = result.message;
    await loadDaemonLogs();
  } catch (error: unknown) {
    daemonControlSuccess.value = false;
    daemonControlMessage.value = getErrorMessage(error);
  } finally {
    daemonControlLoading.value = false;
  }
};

const refreshMonitoring = () => {
  void loadDaemonStatus();
  void loadDaemonLogs();
};

const stopMonitoringPoll = () => {
  if (monitoringPollTimer === null) return;
  clearInterval(monitoringPollTimer);
  monitoringPollTimer = null;
};

const startMonitoringPoll = () => {
  if (monitoringPollTimer !== null) return;
  monitoringPollTimer = setInterval(() => {
    refreshMonitoring();
  }, MONITORING_POLL_MS);
};

watch(
  () => props.active,
  active => {
    if (active) {
      void loadProviders();
      void loadRuntimeInfo();
      refreshMonitoring();
      startMonitoringPoll();
      return;
    }
    stopMonitoringPoll();
  },
  { immediate: true }
);

onUnmounted(() => {
  stopMonitoringPoll();
});
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.bridges-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-group,
.settings-card {
  margin-bottom: 0;
  box-shadow: none;
}

.config-inline {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  margin-bottom: 0;
}

.input-label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  margin-bottom: 0;
}

.input-label input,
.input-label select,
.input-label textarea {
  margin-top: 0;
  border-radius: 12px;
  font: inherit;
}

.checkbox-label input[type='checkbox'] {
  margin-right: 0;
}

.warning-text,
.error-text {
  margin-top: 12px;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.summary-label {
  color: var(--text-secondary);
}

.summary-code {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

.log-view {
  margin: 16px 0 0;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 14px;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--danger-color) 18%, var(--bg-primary));
  color: var(--danger-color);
}

.status-chip.active {
  background: color-mix(in srgb, var(--success-color) 18%, var(--bg-primary));
  color: var(--success-color);
}

.config-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
