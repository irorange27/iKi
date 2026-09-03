import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';

import type { McpServerSummary } from '@iki/backend/types/mcp';
import { createLogger } from '../logger';
import { useI18n } from '../i18n';
import { getElectronApiSliceMethod } from '../services/electron_api';

interface ToolSummary {
  name: string;
  description?: string;
  displayName?: string;
  autoAllowed?: boolean;
  source?: {
    kind?: 'builtin' | 'mcp';
    id?: string;
    name?: string;
  };
}

type McpServerEntry = {
  id: string;
  name: string;
  meta: string;
  statusLabel: string;
  statusToneClass: string;
  selectable: boolean;
};

const SELECTOR_CLOSE_DELAY_MS = 320;

const normalizeStringArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }
  return resolved;
};

const normalizeTools = (input: unknown): ToolSummary[] => {
  if (!Array.isArray(input)) return [];

  const normalized: ToolSummary[] = [];
  for (const tool of input) {
    if (!tool || typeof tool !== 'object') continue;
    const name = (tool as { name?: unknown }).name;
    const description = (tool as { description?: unknown }).description;
    const displayName = (tool as { displayName?: unknown }).displayName;
    const autoAllowed = (tool as { autoAllowed?: unknown }).autoAllowed;
    const source = (tool as { source?: unknown }).source;

    if (typeof name !== 'string' || name.trim().length === 0) continue;

    normalized.push({
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      displayName: typeof displayName === 'string' ? displayName : undefined,
      autoAllowed: autoAllowed === true,
      source: source && typeof source === 'object' ? (source as ToolSummary['source']) : undefined,
    });
  }
  return normalized;
};

const normalizeMcpServers = (input: unknown): McpServerSummary[] => {
  if (!Array.isArray(input)) return [];

  return input
    .map((server: unknown) => {
      if (!server || typeof server !== 'object') return null;
      const candidate = server as McpServerSummary;
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
      return candidate;
    })
    .filter((server): server is McpServerSummary => Boolean(server));
};

const getBuiltinToolOrder = (toolName: string): number => {
  const explicitOrder: Record<string, number> = {
    web: 0,
    fetch: 1,
    read_file: 11,
    edit: 12,
    write_file: 13,
    delete_file: 14,
    shell: 20,
    agent: 21,
    list_awaiters: 45,
    read_awaiter: 46,
    write_awaiter: 47,
    delete_awaiter: 48,
    list_todo_lists: 50,
    read_todo_list: 51,
    write_todo_list: 52,
    delete_todo_list: 53,
    list_proactive_tasks: 60,
    read_proactive_task: 61,
    write_proactive_task: 62,
    delete_proactive_task: 63,
  };

  return explicitOrder[toolName] ?? 100;
};

export const useToolSelector = (params: {
  tools: Readonly<Ref<string[]>>;
  mcpServerIds: Readonly<Ref<string[]>>;
  mode: Readonly<Ref<'manual' | 'auto'>>;
  emitSelection: (payload: {
    mode?: 'manual' | 'auto';
    tools?: string[];
    mcpServerIds?: string[];
  }) => void;
}) => {
  const listTools = getElectronApiSliceMethod('tools', 'list');
  const listMcpServers = getElectronApiSliceMethod('mcp', 'list');
  const toolSelectorLogger = createLogger({ module: 'tool_selector' });
  const { t } = useI18n();

  const showToolSelector = ref(false);
  const availableTools = ref<ToolSummary[]>([]);
  const availableMcpServers = ref<McpServerSummary[]>([]);
  const toolSelectorCloseTimer = ref<number | null>(null);
  const lastLoadedAt = ref(0);
  const mcpServersLoading = ref(false);
  const isMcpSectionExpanded = ref(false);

  const isAutoToolMode = computed(() => params.mode.value === 'auto');

  const builtinTools = computed(() =>
    [...availableTools.value.filter(tool => tool.source?.kind !== 'mcp')].sort((a, b) => {
      const orderDiff = getBuiltinToolOrder(a.name) - getBuiltinToolOrder(b.name);
      if (orderDiff !== 0) return orderDiff;
      return (a.displayName || a.name).localeCompare(b.displayName || b.name);
    })
  );

  const builtinToolNameSet = computed(() => new Set(builtinTools.value.map(tool => tool.name)));

  const getDerivedSelectedMcpServerIds = () => {
    const selectedToolNames = new Set(normalizeStringArray(params.tools.value));
    const derivedIds = new Set<string>();

    for (const tool of availableTools.value) {
      if (tool.source?.kind !== 'mcp' || !tool.source.id) continue;
      if (!selectedToolNames.has(tool.name)) continue;
      derivedIds.add(tool.source.id);
    }

    return Array.from(derivedIds).sort((a, b) => a.localeCompare(b));
  };

  const selectedMcpServerIds = computed(() => {
    const explicit = normalizeStringArray(params.mcpServerIds.value);
    return explicit.length > 0 ? explicit : getDerivedSelectedMcpServerIds();
  });

  const selectedTools = computed(() =>
    normalizeStringArray(params.tools.value).filter(toolName => builtinToolNameSet.value.has(toolName))
  );

  const triggerTitle = computed(() => {
    if (isAutoToolMode.value) {
      return t('chat.tools.trigger.auto');
    }

    const totalCount = selectedTools.value.length + selectedMcpServerIds.value.length;
    if (totalCount > 0) {
      return t('chat.tools.trigger.selected', { count: totalCount });
    }
    return t('chat.tools.trigger.choose');
  });

  const getMcpToolNamesForServer = (serverId: string): string[] =>
    availableTools.value
      .filter(tool => tool.source?.kind === 'mcp' && tool.source.id === serverId)
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name))
      .map(tool => tool.name);

  const composeToolSelection = (builtinToolNames: string[], mcpServerIds: string[]): string[] => {
    const nextToolNames: string[] = [];
    const seen = new Set<string>();

    for (const toolName of normalizeStringArray(builtinToolNames)) {
      if (!builtinToolNameSet.value.has(toolName) || seen.has(toolName)) continue;
      seen.add(toolName);
      nextToolNames.push(toolName);
    }

    for (const serverId of normalizeStringArray(mcpServerIds)) {
      for (const toolName of getMcpToolNamesForServer(serverId)) {
        if (seen.has(toolName)) continue;
        seen.add(toolName);
        nextToolNames.push(toolName);
      }
    }

    return nextToolNames;
  };

  const mcpServerEntries = computed<McpServerEntry[]>(() => {
    const toolCountByServer = new Map<string, number>();
    const toolNameByServer = new Map<string, string>();

    for (const tool of availableTools.value) {
      if (tool.source?.kind !== 'mcp' || !tool.source.id) continue;
      toolCountByServer.set(tool.source.id, (toolCountByServer.get(tool.source.id) || 0) + 1);
      if (tool.source.name) {
        toolNameByServer.set(tool.source.id, tool.source.name);
      }
    }

    const entries = new Map<string, McpServerEntry>();

    for (const server of availableMcpServers.value) {
      const toolCount = toolCountByServer.get(server.id) ?? server.status?.toolCount ?? 0;
      const state = server.status?.state ?? (toolCount > 0 ? 'connected' : 'disconnected');
      const selectable = Boolean(server.enabled) && state === 'connected' && toolCount > 0;
      const toolLabel = t('chat.tools.toolCount', { count: toolCount });
      const statusLabel = !server.enabled
        ? t('chat.tools.statusDisabled')
        : state === 'connected'
          ? t('chat.tools.statusConnected')
          : state === 'connecting'
            ? t('chat.tools.statusConnecting')
            : state === 'error'
              ? t('chat.tools.statusError')
              : t('chat.tools.statusDisconnected');
      const metaParts = [toolLabel];
      if (state === 'error' && server.status?.lastError) {
        metaParts.push(server.status.lastError);
      }

      entries.set(server.id, {
        id: server.id,
        name: server.name,
        meta: metaParts.join(' · '),
        statusLabel,
        statusToneClass:
          state === 'connected'
            ? 'status-connected'
            : state === 'error'
              ? 'status-error'
              : 'status-idle',
        selectable,
      });
    }

    for (const [serverId, toolCount] of toolCountByServer.entries()) {
      if (entries.has(serverId)) continue;
      entries.set(serverId, {
        id: serverId,
        name: toolNameByServer.get(serverId) || serverId,
        meta: t('chat.tools.toolCount', { count: toolCount }),
        statusLabel: t('chat.tools.statusConnected'),
        statusToneClass: 'status-connected',
        selectable: toolCount > 0,
      });
    }

    return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  const showMcpSection = computed(
    () =>
      Boolean(listMcpServers) ||
      availableMcpServers.value.length > 0 ||
      mcpServerEntries.value.length > 0
  );

  const emitSelection = (builtinToolNames: string[], mcpServerIds: string[]) => {
    const normalizedMcpServerIds = normalizeStringArray(mcpServerIds);
    params.emitSelection({
      mcpServerIds: normalizedMcpServerIds,
      tools: composeToolSelection(builtinToolNames, normalizedMcpServerIds),
    });
  };

  const loadAvailableTools = async (options?: { force?: boolean }) => {
    const now = Date.now();
    if (!options?.force && now - lastLoadedAt.value < 800) return;

    try {
      const tools = listTools ? await listTools() : [];
      availableTools.value = normalizeTools(tools);
      lastLoadedAt.value = now;
    } catch (error) {
      toolSelectorLogger.event({
        level: 'error',
        event: 'tools.load',
        outcome: 'failed',
        error,
      });
      availableTools.value = [];
    }
  };

  const loadAvailableMcpServers = async () => {
    if (!listMcpServers) {
      availableMcpServers.value = [];
      return;
    }

    if (mcpServersLoading.value) return;
    mcpServersLoading.value = true;
    try {
      const servers = await listMcpServers();
      availableMcpServers.value = normalizeMcpServers(servers);
    } catch (error) {
      toolSelectorLogger.event({
        level: 'error',
        event: 'mcp.servers.load',
        outcome: 'failed',
        error,
      });
      availableMcpServers.value = [];
    } finally {
      mcpServersLoading.value = false;
    }
  };

  const refreshMcpServers = async () => {
    await Promise.all([loadAvailableTools({ force: true }), loadAvailableMcpServers()]);
  };

  const toggleAutoToolMode = () => {
    params.emitSelection({ mode: isAutoToolMode.value ? 'manual' : 'auto' });
  };

  const isBuiltinToolSelected = (toolName: string) => selectedTools.value.includes(toolName);

  const toggleBuiltinTool = (toolName: string) => {
    if (isAutoToolMode.value) return;

    const nextBuiltins = isBuiltinToolSelected(toolName)
      ? selectedTools.value.filter(name => name !== toolName)
      : [...selectedTools.value, toolName];

    emitSelection(nextBuiltins, selectedMcpServerIds.value);
  };

  const selectAllBuiltinTools = () => {
    if (isAutoToolMode.value) return;
    emitSelection(
      builtinTools.value.map(tool => tool.name),
      selectedMcpServerIds.value
    );
  };

  const clearBuiltinTools = () => {
    if (isAutoToolMode.value) return;
    emitSelection([], selectedMcpServerIds.value);
  };

  const isMcpServerSelected = (serverId: string) => selectedMcpServerIds.value.includes(serverId);

  const toggleMcpServer = (serverId: string) => {
    const current = new Set(selectedMcpServerIds.value);
    if (current.has(serverId)) {
      current.delete(serverId);
    } else {
      current.add(serverId);
    }
    emitSelection(selectedTools.value, Array.from(current));
  };

  const selectAllMcpServers = () => {
    const selectableServerIds = mcpServerEntries.value
      .filter(server => server.selectable)
      .map(server => server.id);
    emitSelection(selectedTools.value, selectableServerIds);
  };

  const clearAllMcpServers = () => {
    emitSelection(selectedTools.value, []);
  };

  const toggleMcpSection = () => {
    isMcpSectionExpanded.value = !isMcpSectionExpanded.value;
  };

  const openToolSelector = () => {
    if (toolSelectorCloseTimer.value !== null) {
      window.clearTimeout(toolSelectorCloseTimer.value);
      toolSelectorCloseTimer.value = null;
    }
    showToolSelector.value = true;
    void Promise.all([loadAvailableTools(), loadAvailableMcpServers()]);
  };

  const scheduleCloseToolSelector = () => {
    if (toolSelectorCloseTimer.value !== null) {
      window.clearTimeout(toolSelectorCloseTimer.value);
    }
    toolSelectorCloseTimer.value = window.setTimeout(() => {
      showToolSelector.value = false;
      toolSelectorCloseTimer.value = null;
    }, SELECTOR_CLOSE_DELAY_MS);
  };

  onMounted(() => {
    void Promise.all([loadAvailableTools(), loadAvailableMcpServers()]);
  });

  onUnmounted(() => {
    if (toolSelectorCloseTimer.value !== null) {
      window.clearTimeout(toolSelectorCloseTimer.value);
      toolSelectorCloseTimer.value = null;
    }
  });

  return {
    builtinTools,
    clearAllMcpServers,
    clearBuiltinTools,
    isAutoToolMode,
    isBuiltinToolSelected,
    isMcpSectionExpanded,
    isMcpServerSelected,
    mcpServerEntries,
    mcpServersLoading,
    openToolSelector,
    refreshMcpServers,
    scheduleCloseToolSelector,
    selectAllBuiltinTools,
    selectAllMcpServers,
    selectedMcpServerIds,
    selectedTools,
    showMcpSection,
    showToolSelector,
    t,
    toggleAutoToolMode,
    toggleBuiltinTool,
    toggleMcpSection,
    toggleMcpServer,
    triggerTitle,
  };
};
