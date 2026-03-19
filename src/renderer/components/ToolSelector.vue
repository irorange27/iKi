<template>
  <div class="relative" @mouseenter="openToolSelector" @mouseleave="scheduleCloseToolSelector">
    <button
      class="relative flex h-8 w-8 items-center justify-center rounded-lg text-secondary icon-btn"
      :class="{
        'text-accent':
          isAutoToolMode || selectedTools.length > 0 || selectedMcpServerIds.length > 0,
      }"
      @click="showToolSelector = !showToolSelector"
      @mouseenter="openToolSelector"
      @mouseleave="scheduleCloseToolSelector"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
        />
      </svg>
      <span
        v-if="isAutoToolMode || selectedTools.length > 0 || selectedMcpServerIds.length > 0"
        class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white"
      >
        {{ isAutoToolMode ? 'A' : selectedTools.length + selectedMcpServerIds.length }}
      </span>
    </button>

    <div
      v-if="showToolSelector"
      class="absolute bottom-full left-0 z-50 mb-2 w-[22rem] overflow-hidden rounded-2xl border border-color bg-secondary shadow-xl"
      @mouseenter="openToolSelector"
      @mouseleave="scheduleCloseToolSelector"
    >
      <div class="border-b border-color bg-tertiary p-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-primary">Tools</span>
        </div>
        <div class="mt-1 text-xs leading-snug text-muted">
          Allow iKi to use built-in tools for the next response. Safe MCP tools from enabled servers
          can also be considered.
        </div>

        <div class="mt-3 flex items-center gap-2">
          <button
            class="tool-mode-btn"
            :class="{ active: isAutoToolMode }"
            @click="toggleAutoToolMode"
          >
            Auto
          </button>
          <div class="flex-1" />
          <button class="tool-action-btn" :disabled="isAutoToolMode" @click="selectAllBuiltinTools">
            Select all
          </button>
          <button class="tool-action-btn" :disabled="isAutoToolMode" @click="clearBuiltinTools">
            Clear all
          </button>
        </div>

        <div v-if="isAutoToolMode" class="mt-2 text-xs leading-snug text-accent">
          Auto only considers built-in tools plus safe tools from the MCP servers enabled below.
        </div>
      </div>

      <div class="max-h-[34rem] overflow-y-auto">
        <div class="p-2">
          <div v-if="builtinToolGroups.length === 0" class="p-4 text-center text-sm text-muted">
            No built-in tools available.
          </div>
          <div v-else class="tool-groups">
            <div v-for="group in builtinToolGroups" :key="group.key" class="tool-group">
              <div class="tool-group-title">{{ group.label }}</div>
              <button
                v-for="tool in group.tools"
                :key="tool.name"
                class="tool-row"
                :disabled="isAutoToolMode"
                :class="{
                  'tool-row-selected': isBuiltinToolSelected(tool.name) && !isAutoToolMode,
                  'tool-row-disabled': isAutoToolMode,
                }"
                @click="toggleBuiltinTool(tool.name)"
              >
                <div class="flex flex-col">
                  <span class="font-medium">{{ tool.displayName || tool.name }}</span>
                  <span class="tool-description">
                    {{ tool.description }}
                  </span>
                </div>
                <div
                  class="tool-check"
                  :class="{
                    'tool-check-active': isBuiltinToolSelected(tool.name) && !isAutoToolMode,
                  }"
                >
                  <svg
                    v-if="isBuiltinToolSelected(tool.name) && !isAutoToolMode"
                    class="h-3 w-3 text-white"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div v-if="showMcpSection" class="border-t border-color px-4 py-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-primary">
              <svg
                class="h-4 w-4 text-secondary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 7V5a2 2 0 114 0v2m4 0h1a2 2 0 012 2v2a2 2 0 01-2 2h-1m-8-6H7a2 2 0 00-2 2v2a2 2 0 002 2h1m8 0v2a2 2 0 11-4 0v-2m-4 0v2a2 2 0 104 0v-2"
                />
              </svg>
              <span class="text-sm font-semibold">MCP Servers</span>
            </div>

            <button
              class="tool-icon-btn"
              :disabled="mcpServersLoading"
              title="Refresh MCP servers"
              @click="refreshMcpServers"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 015.17 15m14.249 0H15"
                />
              </svg>
            </button>
          </div>

          <div class="mt-3 text-xs leading-snug text-muted">
            Enable MCP servers for this conversation. Manual mode exposes all tools from enabled
            servers. Auto mode only considers their safe tools.
          </div>

          <div class="mt-3 flex items-center gap-2">
            <button class="tool-action-btn" @click="selectAllMcpServers">Select all</button>
            <button class="tool-action-btn" @click="clearAllMcpServers">Clear all</button>
          </div>

          <div v-if="mcpServersLoading" class="mcp-empty-state">Loading MCP servers...</div>
          <div v-else-if="mcpServerEntries.length === 0" class="mcp-empty-state">
            No MCP servers configured.
          </div>
          <div v-else class="mt-3 flex flex-col gap-2">
            <button
              v-for="server in mcpServerEntries"
              :key="server.id"
              class="mcp-server-row"
              :class="{ disabled: !server.selectable }"
              :disabled="!server.selectable"
              @click="toggleMcpServer(server.id)"
            >
              <span class="server-switch" :class="{ active: isMcpServerSelected(server.id) }">
                <span class="server-switch-thumb" />
              </span>

              <span class="server-copy">
                <span class="server-name-row">
                  <span class="server-name">{{ server.name }}</span>
                  <span class="server-status" :class="server.statusToneClass">
                    {{ server.statusLabel }}
                  </span>
                </span>
                <span class="server-meta">{{ server.meta }}</span>
              </span>

              <span class="server-health-dot" :class="server.healthClass" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { McpServerSummary } from '../../shared/types/mcp';

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

interface ElectronToolsApi {
  tools?: {
    list?: () => Promise<unknown>;
  };
  mcp?: {
    list?: () => Promise<unknown>;
  };
}

type ToolGroup = {
  key: string;
  label: string;
  order: number;
  tools: ToolSummary[];
};

type McpServerEntry = {
  id: string;
  name: string;
  meta: string;
  statusLabel: string;
  statusToneClass: string;
  healthClass: string;
  selectable: boolean;
};

const props = defineProps<{
  tools: string[];
  mcpServerIds: string[];
  mode: 'manual' | 'auto';
}>();

const emit = defineEmits<{
  (event: 'update:tools', value: string[]): void;
  (event: 'update:mcpServerIds', value: string[]): void;
  (event: 'update:mode', value: 'manual' | 'auto'): void;
}>();

const electronAPI = (window as Window & { electronAPI?: ElectronToolsApi }).electronAPI;

const showToolSelector = ref(false);
const availableTools = ref<ToolSummary[]>([]);
const availableMcpServers = ref<McpServerSummary[]>([]);
const toolSelectorCloseTimer = ref<number | null>(null);
const lastLoadedAt = ref(0);
const mcpServersLoading = ref(false);
const didInitializeDefaultSelection = ref(false);
const isAutoToolMode = computed(() => props.mode === 'auto');

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

  return input
    .map((tool: unknown) => {
      if (!tool || typeof tool !== 'object') return null;
      const name = (tool as { name?: unknown }).name;
      const description = (tool as { description?: unknown }).description;
      const displayName = (tool as { displayName?: unknown }).displayName;
      const autoAllowed = (tool as { autoAllowed?: unknown }).autoAllowed;
      const source = (tool as { source?: unknown }).source;

      if (typeof name !== 'string' || name.trim().length === 0) return null;

      return {
        name: name.trim(),
        description: typeof description === 'string' ? description : '',
        displayName: typeof displayName === 'string' ? displayName : undefined,
        autoAllowed: autoAllowed === true,
        source:
          source && typeof source === 'object' ? (source as ToolSummary['source']) : undefined,
      };
    })
    .filter((tool): tool is ToolSummary => Boolean(tool));
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

const getBuiltinGroupMeta = (toolName: string): { key: string; label: string; order: number } => {
  if (toolName === 'web' || toolName === 'fetch') {
    return { key: 'web', label: 'Web & Research', order: 0 };
  }
  if (
    toolName === 'read_file' ||
    toolName === 'write_file' ||
    toolName === 'list_dir' ||
    toolName === 'delete_file'
  ) {
    return { key: 'files', label: 'Project & Files', order: 1 };
  }
  if (toolName === 'shell') {
    return { key: 'execution', label: 'Execution', order: 2 };
  }
  return { key: 'builtin', label: 'Built-in Tools', order: 3 };
};

const builtinTools = computed(() =>
  availableTools.value.filter(tool => tool.source?.kind !== 'mcp')
);

const builtinToolNameSet = computed(() => new Set(builtinTools.value.map(tool => tool.name)));

const builtinToolGroups = computed(() => {
  const groups = new Map<string, ToolGroup>();

  for (const tool of builtinTools.value) {
    const meta = getBuiltinGroupMeta(tool.name);
    if (!groups.has(meta.key)) {
      groups.set(meta.key, { ...meta, tools: [] });
    }
    groups.get(meta.key)!.tools.push(tool);
  }

  const result = Array.from(groups.values());
  result.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  for (const group of result) {
    group.tools.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
  }
  return result;
});

const getDerivedSelectedMcpServerIds = () => {
  const selectedToolNames = new Set(normalizeStringArray(props.tools));
  const derivedIds = new Set<string>();

  for (const tool of availableTools.value) {
    if (tool.source?.kind !== 'mcp' || !tool.source.id) continue;
    if (!selectedToolNames.has(tool.name)) continue;
    derivedIds.add(tool.source.id);
  }

  return Array.from(derivedIds).sort((a, b) => a.localeCompare(b));
};

const selectedMcpServerIds = computed(() => {
  const explicit = normalizeStringArray(props.mcpServerIds);
  return explicit.length > 0 ? explicit : getDerivedSelectedMcpServerIds();
});

const selectedTools = computed(() =>
  normalizeStringArray(props.tools).filter(toolName => builtinToolNameSet.value.has(toolName))
);

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
    const toolLabel = `${toolCount} tool${toolCount === 1 ? '' : 's'}`;
    const statusLabel = !server.enabled
      ? 'Disabled'
      : state === 'connected'
        ? 'Connected'
        : state === 'connecting'
          ? 'Connecting'
          : state === 'error'
            ? 'Error'
            : 'Disconnected';
    const metaParts = [toolLabel];
    if (state === 'error' && server.status?.lastError) {
      metaParts.push(server.status.lastError);
    } else if (!selectable && state !== 'error') {
      metaParts.push(statusLabel);
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
      healthClass:
        state === 'connected'
          ? 'health-connected'
          : state === 'error'
            ? 'health-error'
            : 'health-idle',
      selectable,
    });
  }

  for (const [serverId, toolCount] of toolCountByServer.entries()) {
    if (entries.has(serverId)) continue;
    entries.set(serverId, {
      id: serverId,
      name: toolNameByServer.get(serverId) || serverId,
      meta: `${toolCount} tool${toolCount === 1 ? '' : 's'}`,
      statusLabel: 'Connected',
      statusToneClass: 'status-connected',
      healthClass: 'health-connected',
      selectable: toolCount > 0,
    });
  }

  return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
});

const showMcpSection = computed(
  () =>
    Boolean(electronAPI?.mcp?.list) ||
    availableMcpServers.value.length > 0 ||
    mcpServerEntries.value.length > 0
);

const emitSelection = (builtinToolNames: string[], mcpServerIds: string[]) => {
  const normalizedMcpServerIds = normalizeStringArray(mcpServerIds);
  emit('update:mcpServerIds', normalizedMcpServerIds);
  emit('update:tools', composeToolSelection(builtinToolNames, normalizedMcpServerIds));
};

const loadAvailableTools = async (options?: { force?: boolean }) => {
  const now = Date.now();
  if (!options?.force && now - lastLoadedAt.value < 800) return;

  try {
    const tools = await electronAPI?.tools?.list?.();
    const normalized = normalizeTools(tools);
    availableTools.value = normalized;
    lastLoadedAt.value = now;

    if (
      !didInitializeDefaultSelection.value &&
      !isAutoToolMode.value &&
      props.tools.length === 0 &&
      props.mcpServerIds.length === 0
    ) {
      const defaults = normalized
        .filter(tool => tool.source?.kind !== 'mcp')
        .map(tool => tool.name);
      if (defaults.length > 0) {
        didInitializeDefaultSelection.value = true;
        emitSelection(defaults, []);
      }
    }
  } catch (error) {
    console.error('Failed to load tools:', error);
    availableTools.value = [];
  }
};

const loadAvailableMcpServers = async () => {
  if (!electronAPI?.mcp?.list) {
    availableMcpServers.value = [];
    return;
  }

  mcpServersLoading.value = true;
  try {
    const servers = await electronAPI.mcp.list();
    availableMcpServers.value = normalizeMcpServers(servers);
  } catch (error) {
    console.error('Failed to load MCP servers:', error);
    availableMcpServers.value = [];
  } finally {
    mcpServersLoading.value = false;
  }
};

const refreshMcpServers = async () => {
  await Promise.all([loadAvailableTools({ force: true }), loadAvailableMcpServers()]);
};

const toggleAutoToolMode = () => {
  emit('update:mode', isAutoToolMode.value ? 'manual' : 'auto');
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
  }, 180);
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
</script>

<style scoped>
.text-primary {
  color: var(--text-primary);
}

.text-secondary {
  color: var(--text-secondary);
}

.text-muted {
  color: var(--text-muted);
}

.text-accent {
  color: var(--accent-color);
}

.border-color {
  border-color: var(--border-color);
}

.bg-secondary {
  background-color: var(--bg-secondary);
}

.bg-tertiary {
  background-color: var(--bg-tertiary);
}

.shadow-xl {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.2),
    0 10px 10px -5px rgba(0, 0, 0, 0.1);
}

.icon-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.bg-\[\#4a9eff\] {
  background-color: var(--accent-color);
}

.tool-mode-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
}

.tool-mode-btn.active {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.18);
  border-color: rgba(var(--accent-rgb, 74, 158, 255), 0.35);
  color: var(--text-primary);
}

.tool-action-btn,
.tool-icon-btn {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.tool-action-btn {
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 11px;
  background: transparent;
}

.tool-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: transparent;
}

.tool-action-btn:hover:not(:disabled),
.tool-icon-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.tool-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-group-title {
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tool-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  text-align: left;
  color: var(--text-primary);
}

.tool-row:hover:not(:disabled) {
  background: var(--bg-hover);
}

.tool-row-selected {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.1);
  color: var(--accent-color);
}

.tool-row-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tool-description {
  max-width: 220px;
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
}

.tool-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1px solid var(--border-color);
  flex-shrink: 0;
}

.tool-check-active {
  background: var(--accent-color);
  border-color: var(--accent-color);
}

.mcp-empty-state {
  margin-top: 12px;
  border: 1px dashed var(--border-color);
  border-radius: 14px;
  padding: 12px;
  font-size: 12px;
  text-align: center;
  color: var(--text-muted);
}

.mcp-server-row {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  text-align: left;
}

.mcp-server-row:hover:not(:disabled) {
  background: var(--bg-hover);
}

.mcp-server-row.disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.server-switch {
  position: relative;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: rgba(99, 114, 143, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background-color 0.2s ease;
}

.server-switch.active {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.42);
}

.server-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #f8fafc;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease;
}

.server-switch.active .server-switch-thumb {
  transform: translateX(18px);
  background: #ffffff;
}

.server-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.server-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.server-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-status {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.server-meta {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-health-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.status-connected {
  color: #34d399;
}

.status-error {
  color: #f87171;
}

.status-idle {
  color: var(--text-muted);
}

.health-connected {
  background: #10b981;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.health-error {
  background: #ef4444;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
}

.health-idle {
  background: #64748b;
  box-shadow: 0 0 0 4px rgba(100, 116, 139, 0.12);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
