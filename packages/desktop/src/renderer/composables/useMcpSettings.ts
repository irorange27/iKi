import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../i18n';
import { getElectronApiSliceMethod } from '../services/electron_api';
import { useConfigStore } from '../store/config';
import type { AppConfig } from '@iki/core/types/config';
import type {
  McpApprovalMode,
  McpServerInput,
  McpServerSummary,
  McpTransport,
} from '@iki/core/types/mcp';
import { getErrorMessage } from '@iki/core/utils/errors';

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

export const useMcpSettings = (onConfigChange: () => void) => {
  const { t } = useI18n();
  const listMcpServers = getElectronApiSliceMethod('mcp', 'list');
  const addMcpServer = getElectronApiSliceMethod('mcp', 'add');
  const updateMcpServer = getElectronApiSliceMethod('mcp', 'update');
  const deleteMcpServer = getElectronApiSliceMethod('mcp', 'delete');
  const connectMcpServer = getElectronApiSliceMethod('mcp', 'connect');
  const disconnectMcpServer = getElectronApiSliceMethod('mcp', 'disconnect');
  const refreshMcpServerTools = getElectronApiSliceMethod('mcp', 'refreshTools');

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
    onConfigChange();
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
      if (!listMcpServers) {
        serversError.value = t('settings.mcp.error.apiUnavailable');
        servers.value = [];
        return;
      }
      const list = await listMcpServers();
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

  const formatStringMap = (value: Record<string, string> | null | undefined): string => {
    if (!value) return '';
    return Object.entries(value)
      .map(([key, val]) => `${key}=${val}`)
      .join('\n');
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

  const buildServerPayload = (): McpServerInput | null => {
    const name = form.value.name.trim();
    if (!name) {
      formError.value = t('settings.mcp.error.serverNameRequired');
      return null;
    }

    const toolAllowlist = parseLineList(form.value.toolAllowlist);
    const args = form.value.transport === 'stdio' ? parseLineList(form.value.args) : null;
    const envResult =
      form.value.transport === 'stdio'
        ? parseStringMap(form.value.env)
        : { value: null, error: '' };
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

    if ((editingServerId.value && !updateMcpServer) || (!editingServerId.value && !addMcpServer)) {
      formError.value = t('settings.mcp.error.apiUnavailable');
      return;
    }

    formSaving.value = true;
    try {
      if (editingServerId.value) {
        await updateMcpServer?.(editingServerId.value, payload);
      } else {
        await addMcpServer?.(payload);
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
    if (!deleteMcpServer) return;
    if (!window.confirm(t('settings.mcp.confirmDelete', { name: server.name }))) return;
    actionLoading.value = true;
    actionError.value = '';
    try {
      await deleteMcpServer(server.id);
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
    if (!connectMcpServer) return;
    actionLoading.value = true;
    actionError.value = '';
    try {
      await connectMcpServer(server.id);
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
    if (!disconnectMcpServer) return;
    actionLoading.value = true;
    actionError.value = '';
    try {
      await disconnectMcpServer(server.id);
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
    if (!refreshMcpServerTools) return;
    actionLoading.value = true;
    actionError.value = '';
    try {
      await refreshMcpServerTools(server.id);
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

  return {
    actionError,
    actionLoading,
    canConnect,
    canDisconnect,
    canRefresh,
    cancelForm,
    config,
    connectServer,
    deleteServer,
    disconnectServer,
    editingServerId,
    form,
    formError,
    formOpen,
    formSaving,
    formatTimestamp,
    formatTransport,
    loadServers,
    mcpApprovalOverrideOptions,
    mcpDefaultApprovalModeOptions,
    mcpTransportOptions,
    refreshTools,
    saveServer,
    servers,
    serversError,
    serversLoading,
    startAddServer,
    startEditServer,
    statusClass,
    statusLabel,
    updateDefaultApprovalModeSelection,
    updateFormApprovalModeSelection,
    updateFormTransportSelection,
    updateMcp,
  };
};
