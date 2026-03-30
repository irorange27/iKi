<template>
  <div class="relative" @mouseenter="openToolSelector" @mouseleave="scheduleCloseToolSelector">
    <button
      class="composer-control-btn composer-selector-trigger ui-text-secondary relative flex h-10 w-10 items-center justify-center rounded-[14px]"
      :class="{
        'ui-text-accent':
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
        class="selector-badge"
      >
        {{ isAutoToolMode ? 'A' : selectedTools.length + selectedMcpServerIds.length }}
      </span>
    </button>

    <div
      v-if="showToolSelector"
      class="selector-panel"
      @mouseenter="openToolSelector"
      @mouseleave="scheduleCloseToolSelector"
    >
      <div class="selector-panel-header">
        <div class="flex items-center justify-between">
          <span class="selector-panel-title ui-text-primary">{{ t('chat.tools.title') }}</span>
        </div>
        <div class="selector-panel-description ui-text-muted">
          {{ t('chat.tools.description') }}
        </div>

        <div class="selector-panel-toolbar">
          <button
            class="selector-mode-btn"
            :class="{ active: isAutoToolMode }"
            @click="toggleAutoToolMode"
          >
            {{ t('chat.tools.auto') }}
          </button>
          <div class="selector-toolbar-spacer" />
          <button
            class="selector-action-btn"
            :disabled="isAutoToolMode"
            @click="selectAllBuiltinTools"
          >
            {{ t('chat.tools.selectAll') }}
          </button>
          <button class="selector-action-btn" :disabled="isAutoToolMode" @click="clearBuiltinTools">
            {{ t('chat.tools.clear') }}
          </button>
        </div>

        <div v-if="isAutoToolMode" class="ui-text-accent mt-2 text-xs leading-snug">
          {{ t('chat.tools.autoDescription') }}
        </div>
      </div>

      <div class="selector-list">
        <div v-if="builtinTools.length === 0" class="selector-empty-state">
          {{ t('chat.tools.noBuiltins') }}
        </div>
        <button
          v-for="tool in builtinTools"
          :key="tool.name"
          class="selector-item"
          :disabled="isAutoToolMode"
          :class="{
            'selector-item-selected': isBuiltinToolSelected(tool.name) && !isAutoToolMode,
            'selector-item-disabled': isAutoToolMode,
          }"
          @click="toggleBuiltinTool(tool.name)"
        >
          <div class="selector-item-copy">
            <span class="font-medium">{{ tool.displayName || tool.name }}</span>
            <span class="selector-item-description selector-item-description-truncate">
              {{ tool.description }}
            </span>
          </div>
          <div
            class="selector-check"
            :class="{ 'selector-check-active': isBuiltinToolSelected(tool.name) }"
          >
            <svg
              v-if="isBuiltinToolSelected(tool.name)"
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

        <div v-if="showMcpSection" class="selector-subsection">
          <div class="selector-subsection-header">
            <button type="button" class="selector-section-toggle" @click="toggleMcpSection">
              <svg
                class="ui-text-secondary h-4 w-4"
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
              <span class="ui-text-primary text-sm font-semibold">{{
                t('chat.tools.mcpServers')
              }}</span>
              <svg
                class="selector-chevron h-4 w-4"
                :class="{ expanded: isMcpSectionExpanded }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            <button
              class="selector-icon-btn"
              :disabled="mcpServersLoading"
              :title="t('chat.tools.refreshMcpTitle')"
              @click.stop="refreshMcpServers"
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

          <template v-if="isMcpSectionExpanded">
            <div class="selector-subsection-description ui-text-muted">
              {{ t('chat.tools.mcpDescription') }}
            </div>

            <div class="selector-panel-toolbar">
              <button class="selector-action-btn" @click="selectAllMcpServers">
                {{ t('chat.tools.selectAll') }}
              </button>
              <button class="selector-action-btn" @click="clearAllMcpServers">
                {{ t('chat.tools.clear') }}
              </button>
            </div>

            <div v-if="mcpServersLoading" class="mt-3 selector-empty-state">
              {{ t('chat.tools.loadingMcp') }}
            </div>
            <div v-else-if="mcpServerEntries.length === 0" class="mt-3 selector-empty-state">
              {{ t('chat.tools.noMcp') }}
            </div>
            <div v-else class="mt-3 selector-section-stack">
              <button
                v-for="server in mcpServerEntries"
                :key="server.id"
                class="selector-item"
                :class="{
                  'selector-item-selected': isMcpServerSelected(server.id),
                  'selector-item-disabled': !server.selectable,
                }"
                :disabled="!server.selectable"
                @click="toggleMcpServer(server.id)"
              >
                <div class="selector-item-copy">
                  <span class="font-medium">{{ server.name }}</span>
                  <span class="selector-item-description selector-item-description-wide">
                    <span :class="server.statusToneClass">{{ server.statusLabel }}</span>
                    <span v-if="server.meta"> · {{ server.meta }}</span>
                  </span>
                </div>
                <div
                  class="selector-check"
                  :class="{ 'selector-check-active': isMcpServerSelected(server.id) }"
                >
                  <svg
                    v-if="isMcpServerSelected(server.id)"
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
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { McpServerSummary } from '../../shared/types/mcp';
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
    list_dir: 10,
    read_file: 11,
    edit: 12,
    write_file: 13,
    delete_file: 14,
    shell: 20,
  };

  return explicitOrder[toolName] ?? 100;
};

const builtinTools = computed(() =>
  [...availableTools.value.filter(tool => tool.source?.kind !== 'mcp')].sort((a, b) => {
    const orderDiff = getBuiltinToolOrder(a.name) - getBuiltinToolOrder(b.name);
    if (orderDiff !== 0) return orderDiff;
    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
  })
);

const builtinToolNameSet = computed(() => new Set(builtinTools.value.map(tool => tool.name)));

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
  emit('update:mcpServerIds', normalizedMcpServerIds);
  emit('update:tools', composeToolSelection(builtinToolNames, normalizedMcpServerIds));
};

const loadAvailableTools = async (options?: { force?: boolean }) => {
  const now = Date.now();
  if (!options?.force && now - lastLoadedAt.value < 800) return;

  try {
    const tools = listTools ? await listTools() : [];
    const normalized = normalizeTools(tools);
    availableTools.value = normalized;
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
.selector-subsection {
  margin-top: 8px;
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
}

.selector-subsection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.selector-subsection-description {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.4;
}

.selector-section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.selector-chevron {
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.selector-chevron.expanded {
  transform: rotate(180deg);
}

.status-connected {
  color: var(--status-success-color);
}

.status-error {
  color: var(--status-danger-color);
}

.status-idle {
  color: var(--text-muted);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
