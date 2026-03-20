<template>
  <section class="config-section mcp-section">
    <div class="config-group">
      <h3>MCP (Model Context Protocol)</h3>
      <p class="group-description">
        Connect external tool servers and expose their tools in iKi. Remote servers are disabled by
        default and require explicit opt-in.
      </p>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.enabled"
          @change="updateMcp('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable MCP
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.connectOnStartup"
          @change="updateMcp('connectOnStartup', ($event.target as HTMLInputElement).checked)"
        />
        Connect enabled servers on startup
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.allowRemoteServers"
          @change="updateMcp('allowRemoteServers', ($event.target as HTMLInputElement).checked)"
        />
        Allow remote MCP servers (HTTP/SSE)
      </label>
      <p v-if="!config.mcp.allowRemoteServers" class="group-description warning-text">
        Remote servers are blocked unless you enable this toggle.
      </p>

      <label class="input-label">
        <span>Default approval mode</span>
        <select
          :value="config.mcp.defaultApprovalMode"
          @change="
            updateMcp(
              'defaultApprovalMode',
              ($event.target as HTMLSelectElement).value as AppConfig['mcp']['defaultApprovalMode']
            )
          "
        >
          <option value="safe-only">Require approval unless tool is read-only (Recommended)</option>
          <option value="always">Always require approval</option>
          <option value="never">Never require approval</option>
        </select>
      </label>

      <div class="config-inline">
        <label class="input-label">
          <span>Request timeout (ms)</span>
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
          <span>Max concurrent requests</span>
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
          <div class="card-title">Servers</div>
          <div class="card-subtitle">{{ servers.length }} configured</div>
        </div>
        <div class="card-actions">
          <button class="secondary-btn" @click="() => loadServers()" :disabled="serversLoading">
            <RefreshCw :size="14" :class="{ 'animate-spin': serversLoading }" />
            {{ serversLoading ? 'Loading' : 'Refresh' }}
          </button>
          <button class="secondary-btn" @click="startAddServer">Add Server</button>
        </div>
      </div>

      <div v-if="serversLoading" class="empty-state">Loading MCP servers...</div>
      <div v-else-if="serversError" class="error-text">{{ serversError }}</div>
      <div v-else-if="servers.length === 0" class="empty-state">No MCP servers configured yet.</div>
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
                Command: {{ server.command }}
              </span>
              <span
                v-else-if="
                  (server.transport === 'streamable-http' || server.transport === 'sse') &&
                  server.base_url
                "
              >
                URL: {{ server.base_url }}
              </span>
            </div>
            <div class="server-meta">
              <span>Enabled: {{ server.enabled ? 'Yes' : 'No' }}</span>
              <span v-if="server.status?.toolCount !== undefined">
                Tools: {{ server.status.toolCount }}
              </span>
              <span v-if="server.last_connected_at">
                Last connected: {{ formatTimestamp(server.last_connected_at) }}
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
              Connect
            </button>
            <button
              class="secondary-btn"
              :disabled="!canDisconnect(server)"
              @click="disconnectServer(server)"
            >
              Disconnect
            </button>
            <button
              class="secondary-btn"
              :disabled="!canRefresh(server)"
              @click="refreshTools(server)"
            >
              Refresh tools
            </button>
            <button
              class="secondary-btn"
              :disabled="actionLoading"
              @click="startEditServer(server)"
            >
              Edit
            </button>
            <button class="danger-btn" :disabled="actionLoading" @click="deleteServer(server)">
              Delete
            </button>
          </div>
        </div>
      </div>

      <div v-if="actionError" class="error-text">{{ actionError }}</div>
    </div>

    <div v-if="formOpen" class="settings-card">
      <div class="card-header">
        <div class="card-title">
          {{ editingServerId ? 'Edit MCP Server' : 'Add MCP Server' }}
        </div>
        <div class="card-actions">
          <button class="secondary-btn" @click="cancelForm">Cancel</button>
        </div>
      </div>

      <div class="config-grid">
        <label class="input-label">
          <span>Name</span>
          <input v-model="form.name" type="text" placeholder="Local tools" />
        </label>
        <label class="input-label">
          <span>Transport</span>
          <select v-model="form.transport">
            <option value="stdio">Stdio (local process)</option>
            <option value="streamable-http">Streamable HTTP (Recommended)</option>
            <option value="sse">SSE (legacy compatibility)</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="form.enabled" />
          Enabled
        </label>
        <label class="input-label">
          <span>Approval mode override</span>
          <select v-model="form.approvalMode">
            <option value="">Use global default</option>
            <option value="safe-only">Require approval unless read-only</option>
            <option value="always">Always require approval</option>
            <option value="never">Never require approval</option>
          </select>
        </label>
        <label class="input-label">
          <span>Tool allowlist (one per line)</span>
          <textarea v-model="form.toolAllowlist" rows="4" placeholder="tool_one&#10;tool_two" />
        </label>
      </div>

      <p v-if="form.transport === 'streamable-http'" class="group-description">
        AI SDK practice prefers Streamable HTTP for remote MCP servers. It supports modern MCP
        semantics and is the default choice for new integrations.
      </p>
      <p v-else-if="form.transport === 'sse'" class="group-description warning-text">
        SSE is kept for older MCP servers that have not migrated yet. Prefer Streamable HTTP when
        the server supports both.
      </p>

      <template v-if="form.transport === 'stdio'">
        <div class="config-grid">
          <label class="input-label">
            <span>Command</span>
            <input v-model="form.command" type="text" placeholder="node" />
          </label>
          <label class="input-label">
            <span>Working directory (optional)</span>
            <input v-model="form.cwd" type="text" placeholder="/path/to/project" />
          </label>
          <label class="input-label">
            <span>Args (one per line)</span>
            <textarea v-model="form.args" rows="4" placeholder="server.js&#10;--port=7000" />
          </label>
          <label class="input-label">
            <span>Environment (JSON or key=value per line)</span>
            <textarea v-model="form.env" rows="4" placeholder="API_KEY=abc123" />
          </label>
        </div>
      </template>

      <template v-else>
        <div class="config-grid">
          <label class="input-label">
            <span>Base URL</span>
            <input v-model="form.baseUrl" type="text" placeholder="http://localhost:8080" />
          </label>
          <label class="input-label">
            <span>Auth ref (optional)</span>
            <input v-model="form.authRef" type="text" placeholder="keychain:my-mcp" />
          </label>
          <label class="input-label">
            <span>Headers (JSON or key=value per line)</span>
            <textarea v-model="form.headers" rows="4" placeholder="Authorization=Bearer ..." />
          </label>
        </div>
        <p v-if="!config.mcp.allowRemoteServers" class="group-description warning-text">
          Remote HTTP/SSE servers are disabled. Enable "Allow remote MCP servers" to connect to
          non-local URLs.
        </p>
      </template>

      <div class="form-actions">
        <button class="secondary-btn" @click="cancelForm">Cancel</button>
        <button class="primary-btn" :disabled="formSaving" @click="saveServer">
          {{ formSaving ? 'Saving...' : 'Save Server' }}
        </button>
      </div>
      <div v-if="formError" class="error-text">{{ formError }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { RefreshCw } from 'lucide-vue-next';

import { useConfigStore } from '../../store/config';
import type { AppConfig } from '../../../shared/types/config';
import type {
  McpApprovalMode,
  McpServerInput,
  McpServerSummary,
  McpTransport,
} from '../../../shared/types/mcp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();

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

const updateMcp = <K extends keyof AppConfig['mcp']>(key: K, value: AppConfig['mcp'][K]) => {
  config.value.mcp[key] = value;
  emit('config-change');
};

const loadServers = async (options?: { clearActionError?: boolean }) => {
  serversError.value = '';
  if (options?.clearActionError !== false) {
    actionError.value = '';
  }
  serversLoading.value = true;
  try {
    if (!window?.electronAPI?.mcp?.list) {
      serversError.value = 'MCP API is unavailable.';
      servers.value = [];
      return;
    }
    const list = await window.electronAPI.mcp.list();
    servers.value = Array.isArray(list) ? list : [];
  } catch (error: any) {
    serversError.value = error?.message || 'Failed to load MCP servers.';
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
      return { value: null, error: 'Expected a JSON object with string values.' };
    }
    return { value: normalized, error: '' };
  } catch {
    const result: Record<string, string> = {};
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
      if (!match) {
        return { value: null, error: 'Use JSON or key=value lines.' };
      }
      const key = match[1].trim();
      const val = match[2].trim();
      if (!key) {
        return { value: null, error: 'Environment keys cannot be empty.' };
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
    formError.value = 'Server name is required.';
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
      formError.value = 'Command is required for stdio servers.';
      return null;
    }
  } else if (!form.value.baseUrl.trim()) {
    formError.value = 'Base URL is required for HTTP/SSE servers.';
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

  if (!window?.electronAPI?.mcp) {
    formError.value = 'MCP API is unavailable.';
    return;
  }

  formSaving.value = true;
  try {
    if (editingServerId.value) {
      await window.electronAPI.mcp.update(editingServerId.value, payload);
    } else {
      await window.electronAPI.mcp.add(payload);
    }
    formOpen.value = false;
    await loadServers();
  } catch (error: any) {
    formError.value = error?.message || 'Failed to save MCP server.';
  } finally {
    formSaving.value = false;
  }
};

const deleteServer = async (server: McpServerSummary) => {
  if (!window?.electronAPI?.mcp?.delete) return;
  if (!window.confirm(`Delete MCP server "${server.name}"?`)) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await window.electronAPI.mcp.delete(server.id);
  } catch (error: any) {
    actionError.value = error?.message || 'Failed to delete MCP server.';
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const connectServer = async (server: McpServerSummary) => {
  if (!window?.electronAPI?.mcp?.connect) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await window.electronAPI.mcp.connect(server.id);
  } catch (error: any) {
    actionError.value = error?.message || 'Failed to connect MCP server.';
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const disconnectServer = async (server: McpServerSummary) => {
  if (!window?.electronAPI?.mcp?.disconnect) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await window.electronAPI.mcp.disconnect(server.id);
  } catch (error: any) {
    actionError.value = error?.message || 'Failed to disconnect MCP server.';
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const refreshTools = async (server: McpServerSummary) => {
  if (!window?.electronAPI?.mcp?.refreshTools) return;
  actionLoading.value = true;
  actionError.value = '';
  try {
    await window.electronAPI.mcp.refreshTools(server.id);
  } catch (error: any) {
    actionError.value = error?.message || 'Failed to refresh MCP tools.';
  } finally {
    actionLoading.value = false;
    await loadServers({ clearActionError: false });
  }
};

const statusLabel = (server: McpServerSummary): string => {
  if (!server.enabled) return 'Disabled';
  const state = server.status?.state;
  if (state === 'connected') return 'Connected';
  if (state === 'connecting') return 'Connecting';
  if (state === 'error') return 'Error';
  if (server.last_error) return 'Error';
  return 'Disconnected';
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
  transport === 'stdio' ? 'Stdio' : transport === 'sse' ? 'SSE' : 'HTTP';

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
