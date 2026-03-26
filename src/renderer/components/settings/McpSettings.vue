<template>
  <section class="config-section mcp-section">
    <div class="config-group">
      <h3>{{ t('settings.mcp.title') }}</h3>
      <p class="group-description">{{ t('settings.mcp.description') }}</p>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.enabled"
          @change="updateMcp('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.mcp.enable') }}
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.connectOnStartup"
          @change="updateMcp('connectOnStartup', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.mcp.connectOnStartup') }}
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.allowRemoteServers"
          @change="updateMcp('allowRemoteServers', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.mcp.allowRemoteServers') }}
      </label>
      <p v-if="!config.mcp.allowRemoteServers" class="group-description warning-text">
        {{ t('settings.mcp.remoteBlocked') }}
      </p>

      <label class="input-label">
        <span>{{ t('settings.mcp.defaultApprovalMode') }}</span>
        <SettingsSelect
          :model-value="config.mcp.defaultApprovalMode"
          :options="mcpDefaultApprovalModeOptions"
          :aria-label="t('settings.mcp.defaultApprovalModeAria')"
          @update:model-value="updateDefaultApprovalModeSelection"
        />
      </label>

      <div class="config-inline">
        <label class="input-label">
          <span>{{ t('settings.mcp.requestTimeoutMs') }}</span>
          <input
            type="number"
            min="1000"
            step="500"
            :value="config.mcp.requestTimeoutMs"
            @input="
              updateMcp(
                'requestTimeoutMs',
                Math.max(1000, parseInt(($event.target as HTMLInputElement).value || '0'))
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.maxConcurrentRequests') }}</span>
          <input
            type="number"
            min="1"
            step="1"
            :value="config.mcp.maxConcurrentRequests"
            @input="
              updateMcp(
                'maxConcurrentRequests',
                Math.max(1, parseInt(($event.target as HTMLInputElement).value || '0'))
              )
            "
          />
        </label>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ t('settings.mcp.serversTitle') }}</div>
          <div class="card-subtitle">{{ t('settings.mcp.configuredCount', { count: servers.length }) }}</div>
        </div>
        <div class="card-actions">
          <button class="secondary-btn" @click="() => loadServers()" :disabled="serversLoading">
            <RefreshCw :size="14" :class="{ 'animate-spin': serversLoading }" />
            {{ serversLoading ? t('settings.mcp.loading') : t('common.refresh') }}
          </button>
          <button class="secondary-btn" @click="startAddServer">{{ t('settings.mcp.addServer') }}</button>
        </div>
      </div>

      <div v-if="serversLoading" class="empty-state">{{ t('settings.mcp.loadingServers') }}</div>
      <div v-else-if="serversError" class="error-text">{{ serversError }}</div>
      <div v-else-if="servers.length === 0" class="empty-state">{{ t('settings.mcp.empty') }}</div>
      <div v-else class="server-list">
        <div v-for="server in servers" :key="server.id" class="server-row">
          <div class="server-main">
            <div class="server-title">
              <span class="server-name">{{ server.name }}</span>
              <span class="server-transport">{{ formatTransport(server.transport) }}</span>
              <span class="server-status" :class="statusClass(server)">
                {{ statusLabel(server) }}
              </span>
            </div>
            <div class="server-meta">
              <span v-if="server.transport === 'stdio' && server.command">
                {{ t('settings.mcp.meta.command', { value: server.command }) }}
              </span>
              <span
                v-else-if="
                  (server.transport === 'streamable-http' || server.transport === 'sse') &&
                  server.base_url
                "
              >
                {{ t('settings.mcp.meta.url', { value: server.base_url }) }}
              </span>
            </div>
            <div class="server-meta">
              <span>{{ t('settings.mcp.meta.enabled', { value: server.enabled ? t('common.yes') : t('common.no') }) }}</span>
              <span v-if="server.status?.toolCount !== undefined">
                {{ t('settings.mcp.meta.tools', { count: server.status.toolCount }) }}
              </span>
              <span v-if="server.last_connected_at">
                {{ t('settings.mcp.meta.lastConnected', { value: formatTimestamp(server.last_connected_at) }) }}
              </span>
            </div>
            <div v-if="server.last_error" class="error-text server-error">
              {{ server.last_error }}
            </div>
          </div>
          <div class="server-actions">
            <button
              class="secondary-btn"
              :disabled="!canConnect(server)"
              @click="connectServer(server)"
            >
              {{ t('settings.mcp.connect') }}
            </button>
            <button
              class="secondary-btn"
              :disabled="!canDisconnect(server)"
              @click="disconnectServer(server)"
            >
              {{ t('settings.mcp.disconnect') }}
            </button>
            <button
              class="secondary-btn"
              :disabled="!canRefresh(server)"
              @click="refreshTools(server)"
            >
              {{ t('settings.mcp.refreshTools') }}
            </button>
            <button
              class="secondary-btn"
              :disabled="actionLoading"
              @click="startEditServer(server)"
            >
              {{ t('settings.mcp.editServer') }}
            </button>
            <button class="danger-btn" :disabled="actionLoading" @click="deleteServer(server)">
              {{ t('settings.mcp.deleteServer') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="actionError" class="error-text">{{ actionError }}</div>
    </div>

    <div v-if="formOpen" class="settings-card">
      <div class="card-header">
        <div class="card-title">
          {{ editingServerId ? t('settings.mcp.form.editTitle') : t('settings.mcp.form.addTitle') }}
        </div>
        <div class="card-actions">
          <button class="secondary-btn" @click="cancelForm">{{ t('common.cancel') }}</button>
        </div>
      </div>

      <div class="config-grid">
        <label class="input-label">
          <span>{{ t('common.name') }}</span>
          <input v-model="form.name" type="text" :placeholder="t('settings.mcp.form.namePlaceholder')" />
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.form.transport') }}</span>
          <SettingsSelect
            :model-value="form.transport"
            :options="mcpTransportOptions"
            :aria-label="t('settings.mcp.form.transportAria')"
            @update:model-value="updateFormTransportSelection"
          />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="form.enabled" />
          {{ t('common.enabled') }}
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.form.approvalOverride') }}</span>
          <SettingsSelect
            :model-value="form.approvalMode"
            :options="mcpApprovalOverrideOptions"
            :aria-label="t('settings.mcp.form.approvalOverrideAria')"
            @update:model-value="updateFormApprovalModeSelection"
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.form.toolAllowlist') }}</span>
          <textarea
            v-model="form.toolAllowlist"
            rows="4"
            :placeholder="t('settings.mcp.form.toolAllowlistPlaceholder')"
          />
        </label>
      </div>

      <p v-if="form.transport === 'streamable-http'" class="group-description">
        {{ t('settings.mcp.form.streamableHint') }}
      </p>
      <p v-else-if="form.transport === 'sse'" class="group-description warning-text">
        {{ t('settings.mcp.form.sseHint') }}
      </p>

      <template v-if="form.transport === 'stdio'">
        <div class="config-grid">
          <label class="input-label">
            <span>{{ t('settings.mcp.form.command') }}</span>
            <input v-model="form.command" type="text" :placeholder="t('settings.mcp.form.commandPlaceholder')" />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.workingDirectoryOptional') }}</span>
            <input
              v-model="form.cwd"
              type="text"
              :placeholder="t('settings.mcp.form.workingDirectoryPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.args') }}</span>
            <textarea v-model="form.args" rows="4" :placeholder="t('settings.mcp.form.argsPlaceholder')" />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.environment') }}</span>
            <textarea
              v-model="form.env"
              rows="4"
              :placeholder="t('settings.mcp.form.environmentPlaceholder')"
            />
          </label>
        </div>
      </template>

      <template v-else>
        <div class="config-grid">
          <label class="input-label">
            <span>{{ t('settings.mcp.form.baseUrl') }}</span>
            <input v-model="form.baseUrl" type="text" :placeholder="t('settings.mcp.form.baseUrlPlaceholder')" />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.authRefOptional') }}</span>
            <input
              v-model="form.authRef"
              type="text"
              :placeholder="t('settings.mcp.form.authRefPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.headers') }}</span>
            <textarea
              v-model="form.headers"
              rows="4"
              :placeholder="t('settings.mcp.form.headersPlaceholder')"
            />
          </label>
        </div>
        <p v-if="!config.mcp.allowRemoteServers" class="group-description warning-text">
          {{ t('settings.mcp.form.remoteDisabled') }}
        </p>
      </template>

      <div class="form-actions">
        <button class="secondary-btn" @click="cancelForm">{{ t('common.cancel') }}</button>
        <button class="primary-btn" :disabled="formSaving" @click="saveServer">
          {{ formSaving ? t('settings.mcp.form.saving') : t('settings.mcp.form.save') }}
        </button>
      </div>
      <div v-if="formError" class="error-text">{{ formError }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { RefreshCw } from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '../../../shared/types/config';
import type {
  McpApprovalMode,
  McpServerInput,
  McpServerSummary,
  McpTransport,
} from '../../../shared/types/mcp';
import { getErrorMessage } from '../../../shared/utils/errors';

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();
const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const { t } = useI18n();

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const servers = ref<McpServerSummary[]>([]);
const serversLoading = ref(false);
const serversError = ref('');
const actionError = ref('');
const actionLoading = ref(false);
const formOpen = ref(false);
const formSaving = ref(false);
const formError = ref('');
const editingServerId = ref<string | null>(null);

type ServerForm = {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  approvalMode: '' | McpApprovalMode;
  toolAllowlist: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  baseUrl: string;
  headers: string;
  authRef: string;
};

const createEmptyForm = (): ServerForm => ({
  name: '',
  transport: 'stdio',
  enabled: false,
  approvalMode: '',
  toolAllowlist: '',
  command: '',
  args: '',
  cwd: '',
  env: '',
  baseUrl: '',
  headers: '',
  authRef: '',
});

const form = ref<ServerForm>(createEmptyForm());

const mcpDefaultApprovalModeOptions = computed(() => [
  { value: 'safe-only', label: t('settings.mcp.approval.safeOnly') },
  { value: 'always', label: t('settings.mcp.approval.always') },
  { value: 'never', label: t('settings.mcp.approval.never') },
]);

const mcpTransportOptions = computed(() => [
  { value: 'stdio', label: t('settings.mcp.transport.stdio') },
  { value: 'streamable-http', label: t('settings.mcp.transport.streamableHttp') },
  { value: 'sse', label: t('settings.mcp.transport.sse') },
]);

const mcpApprovalOverrideOptions = computed(() => [
  { value: '', label: t('settings.mcp.approval.globalDefault') },
  { value: 'safe-only', label: t('settings.mcp.approval.safeOnlyShort') },
  { value: 'always', label: t('settings.mcp.approval.always') },
  { value: 'never', label: t('settings.mcp.approval.never') },
]);

const updateMcp = <K extends keyof AppConfig['mcp']>(key: K, value: AppConfig['mcp'][K]) => {
  config.value.mcp[key] = value;
  emit('config-change');
};

const updateDefaultApprovalModeSelection = (value: string) => {
  updateMcp('defaultApprovalMode', value as AppConfig['mcp']['defaultApprovalMode']);
};

const updateFormTransportSelection = (value: string) => {
  form.value.transport = value as McpTransport;
};

const updateFormApprovalModeSelection = (value: string) => {
  form.value.approvalMode = value as ServerForm['approvalMode'];
};

const loadServers = async (options?: { clearActionError?: boolean }) => {
  serversError.value = '';
  if (options?.clearActionError !== false) {
    actionError.value = '';
  }
  serversLoading.value = true;
  try {
    if (!electronAPI?.mcp?.list) {
      serversError.value = t('settings.mcp.error.apiUnavailable');
      servers.value = [];
      return;
    }
    const list = await electronAPI.mcp.list();
    servers.value = Array.isArray(list) ? list : [];
  } catch (error: unknown) {
    serversError.value = t('settings.mcp.error.loadFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    serversLoading.value = false;
  }
};

const startAddServer = () => {
  form.value = createEmptyForm();
  editingServerId.value = null;
  formError.value = '';
  formOpen.value = true;
};

const startEditServer = (server: McpServerSummary) => {
  editingServerId.value = server.id;
  form.value = {
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    approvalMode: (server.approval_mode ?? '') as '' | McpApprovalMode,
    toolAllowlist: (server.tool_allowlist ?? []).join('\n'),
    command: server.command ?? '',
    args: (server.args ?? []).join('\n'),
    cwd: server.cwd ?? '',
    env: formatStringMap(server.env),
    baseUrl: server.base_url ?? '',
    headers: formatStringMap(server.headers),
    authRef: server.auth_ref ?? '',
  };
  formError.value = '';
  formOpen.value = true;
};

const cancelForm = () => {
  formOpen.value = false;
  formSaving.value = false;
  formError.value = '';
};

const parseLineList = (value: string): string[] | null => {
  const items = value
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
};

const normalizeStringMap = (raw: unknown): Record<string, string> | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  const map: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key.trim()) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') return null;
    map[key.trim()] = String(value);
  }
  return Object.keys(map).length > 0 ? map : null;
};

const parseStringMap = (value: string): { value: Record<string, string> | null; error: string } => {
  const trimmed = value.trim();
  if (!trimmed) return { value: null, error: '' };

  try {
    const parsed = JSON.parse(trimmed);
    const normalized = normalizeStringMap(parsed);
    if (!normalized) {
      return { value: null, error: t('settings.mcp.error.expectedJsonObject') };
    }
    return { value: normalized, error: '' };
  } catch {
    const result: Record<string, string> = {};
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
      if (!match) {
        return { value: null, error: t('settings.mcp.error.useJsonOrKeyValue') };
      }
      const key = match[1].trim();
      const val = match[2].trim();
      if (!key) {
        return { value: null, error: t('settings.mcp.error.environmentKeyEmpty') };
      }
      result[key] = val;
    }
    return { value: Object.keys(result).length > 0 ? result : null, error: '' };
  }
};

const formatStringMap = (value: Record<string, string> | null | undefined): string => {
  if (!value) return '';
  return Object.entries(value)
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');
};

const buildServerPayload = (): McpServerInput | null => {
  const name = form.value.name.trim();
  if (!name) {
    formError.value = t('settings.mcp.error.serverNameRequired');
    return null;
  }

  const toolAllowlist = parseLineList(form.value.toolAllowlist);
  const args = form.value.transport === 'stdio' ? parseLineList(form.value.args) : null;
  const envResult =
    form.value.transport === 'stdio' ? parseStringMap(form.value.env) : { value: null, error: '' };
  const headerResult =
    form.value.transport === 'streamable-http' || form.value.transport === 'sse'
      ? parseStringMap(form.value.headers)
      : { value: null, error: '' };

  if (envResult.error) {
    formError.value = envResult.error;
    return null;
  }
  if (headerResult.error) {
    formError.value = headerResult.error;
    return null;
  }

  if (form.value.transport === 'stdio') {
    if (!form.value.command.trim()) {
      formError.value = t('settings.mcp.error.commandRequired');
      return null;
    }
  } else if (!form.value.baseUrl.trim()) {
    formError.value = t('settings.mcp.error.baseUrlRequired');
    return null;
  }

  formError.value = '';

  const payload: McpServerInput = {
    name,
    transport: form.value.transport,
    enabled: form.value.enabled,
    approval_mode: form.value.approvalMode || null,
    tool_allowlist: toolAllowlist,
  };

  if (form.value.transport === 'stdio') {
    payload.command = form.value.command.trim();
    payload.args = args;
    payload.cwd = form.value.cwd.trim() || null;
    payload.env = envResult.value;
  } else {
    payload.base_url = form.value.baseUrl.trim();
    payload.headers = headerResult.value;
    payload.auth_ref = form.value.authRef.trim() || null;
  }

  return payload;
};

const saveServer = async () => {
  formError.value = '';
  actionError.value = '';
  const payload = buildServerPayload();
  if (!payload) return;

  if (!electronAPI?.mcp) {
    formError.value = t('settings.mcp.error.apiUnavailable');
    return;
  }

  formSaving.value = true;
  try {
    if (editingServerId.value) {
      await electronAPI.mcp.update(editingServerId.value, payload);
    } else {
      await electronAPI.mcp.add(payload);
    }
    formOpen.value = false;
    await loadServers();
  } catch (error: unknown) {
    formError.value = t('settings.mcp.error.saveFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    formSaving.value = false;
  }
};

const deleteServer = async (server: McpServerSummary) => {
  if (!electronAPI?.mcp?.delete) return;
  if (!window.confirm(t('settings.mcp.confirmDelete', { name: server.name }))) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await electronAPI.mcp.delete(server.id);
  } catch (error: unknown) {
    actionError.value = t('settings.mcp.error.deleteFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const connectServer = async (server: McpServerSummary) => {
  if (!electronAPI?.mcp?.connect) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await electronAPI.mcp.connect(server.id);
  } catch (error: unknown) {
    actionError.value = t('settings.mcp.error.connectFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const disconnectServer = async (server: McpServerSummary) => {
  if (!electronAPI?.mcp?.disconnect) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await electronAPI.mcp.disconnect(server.id);
  } catch (error: unknown) {
    actionError.value = t('settings.mcp.error.disconnectFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const refreshTools = async (server: McpServerSummary) => {
  if (!electronAPI?.mcp?.refreshTools) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await electronAPI.mcp.refreshTools(server.id);
  } catch (error: unknown) {
    actionError.value = t('settings.mcp.error.refreshFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const statusLabel = (server: McpServerSummary): string => {
  if (!server.enabled) return t('settings.mcp.status.disabled');
  const state = server.status?.state;
  if (state === 'connected') return t('settings.mcp.status.connected');
  if (state === 'connecting') return t('settings.mcp.status.connecting');
  if (state === 'error') return t('settings.mcp.status.error');
  if (server.last_error) return t('settings.mcp.status.error');
  return t('settings.mcp.status.disconnected');
};

const statusClass = (server: McpServerSummary): string => {
  if (!server.enabled) return 'status-disabled';
  const state = server.status?.state;
  if (state) return `status-${state}`;
  if (server.last_error) return 'status-error';
  return 'status-disconnected';
};

const canConnect = (server: McpServerSummary): boolean => {
  if (!config.value.mcp.enabled) return false;
  if (!server.enabled) return false;
  const state = server.status?.state;
  if (state === 'connected' || state === 'connecting') return false;
  return !actionLoading.value;
};

const canDisconnect = (server: McpServerSummary): boolean => {
  if (!server.enabled) return false;
  return server.status?.state === 'connected' && !actionLoading.value;
};

const canRefresh = (server: McpServerSummary): boolean => {
  if (!server.enabled) return false;
  return server.status?.state === 'connected' && !actionLoading.value;
};

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatTransport = (transport: McpTransport): string =>
  transport === 'stdio'
    ? t('settings.mcp.transport.stdioShort')
    : transport === 'sse'
      ? 'SSE'
      : t('settings.mcp.transport.httpShort');

onMounted(() => {
  void loadServers();
});

watch(
  () => config.value.mcp.enabled,
  () => {
    void loadServers();
  }
);
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.config-section {
  max-width: 860px;
  padding-top: 8px;
}

.config-inline {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.server-row {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 16px;
  background: var(--bg-secondary);
}

.server-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.server-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.server-name {
  font-weight: 600;
}

.server-transport {
  font-size: 0.8em;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 30%, var(--border-color));
}

.server-status {
  font-size: 0.8em;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.status-connected {
  color: var(--success-color);
  border-color: color-mix(in srgb, var(--success-color) 40%, var(--border-color));
}

.status-connecting {
  color: var(--warning-color);
  border-color: color-mix(in srgb, var(--warning-color) 40%, var(--border-color));
}

.status-error {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 40%, var(--border-color));
}

.status-disconnected,
.status-disabled {
  color: var(--text-muted);
}

.server-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 0.9em;
  color: var(--text-secondary);
}

.server-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 160px;
}

.server-error {
  margin-top: 4px;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 12px;
}

.empty-state {
  color: var(--text-secondary);
  padding: 12px 4px;
}

@media (max-width: 840px) {
  .config-inline,
  .config-grid {
    grid-template-columns: 1fr;
  }

  .server-row {
    flex-direction: column;
  }

  .server-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
