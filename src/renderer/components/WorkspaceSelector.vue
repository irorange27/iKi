<template>
  <div
    class="relative"
    @mouseenter="openWorkspaceSelector"
    @mouseleave="scheduleCloseWorkspaceSelector"
  >
    <button
      class="workspace-selector-trigger composer-control-btn composer-selector-trigger ui-text-secondary relative flex h-10 w-10 items-center justify-center rounded-[14px]"
      :class="{ 'ui-text-accent': isWorkspaceSelectorActive }"
      :title="triggerTitle"
      :aria-label="triggerTitle"
      @click="toggleWorkspaceSelector"
      @mouseenter="openWorkspaceSelector"
      @mouseleave="scheduleCloseWorkspaceSelector"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
      <span v-if="workspaceBadgeLabel" class="selector-badge">
        {{ workspaceBadgeLabel }}
      </span>
    </button>

    <div
      v-if="showWorkspaceSelector"
      class="selector-panel workspace-selector-panel"
      @mouseenter="openWorkspaceSelector"
      @mouseleave="scheduleCloseWorkspaceSelector"
    >
      <div class="selector-panel-header">
        <div class="flex items-center justify-between gap-3">
          <span class="selector-panel-title ui-text-primary">Workspace</span>
          <button
            class="selector-icon-btn workspace-selector-refresh flex h-8 w-8 items-center justify-center rounded-[10px]"
            :disabled="loadingWorkspaces"
            title="Refresh workspaces"
            @click.stop="loadWorkspaces"
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
        <div class="selector-panel-description ui-text-muted">
          Bind this thread to one workspace root. Relative file paths and the default shell working
          directory will follow that workspace.
        </div>
      </div>

      <div class="selector-list">
        <button
          class="selector-item"
          :class="{ 'selector-item-selected': !selectedWorkspaceId }"
          @click="selectWorkspace(null)"
        >
          <div class="selector-item-copy">
            <span class="font-medium">No workspace</span>
            <span class="selector-item-description selector-item-description-wide">
              Leave the thread unpinned and use the global visible workspace set instead.
            </span>
          </div>
          <div
            class="selector-check"
            :class="{ 'selector-check-active': !selectedWorkspaceId }"
          >
            <svg
              v-if="!selectedWorkspaceId"
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

        <div v-if="loadingWorkspaces" class="selector-empty-state">Loading workspaces...</div>
        <div v-else-if="workspaceLoadError" class="selector-empty-state">
          {{ workspaceLoadError }}
        </div>
        <div v-else-if="availableWorkspaces.length === 0" class="selector-empty-state">
          No visible workspaces available.
        </div>
        <button
          v-for="workspace in availableWorkspaces"
          :key="workspace.id"
          class="selector-item"
          :class="{ 'selector-item-selected': selectedWorkspaceId === workspace.id }"
          @click="selectWorkspace(workspace.id)"
        >
          <div class="selector-item-copy">
            <span class="font-medium">{{ workspace.name }}</span>
            <span class="selector-item-description selector-item-description-wide">
              {{ workspace.path }}
              <span v-if="workspace.show_in_list !== 1"> · Hidden from global list</span>
            </span>
          </div>
          <div
            class="selector-check"
            :class="{ 'selector-check-active': selectedWorkspaceId === workspace.id }"
          >
            <svg
              v-if="selectedWorkspaceId === workspace.id"
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
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Workspace } from '../../shared/types/chat';
import { getErrorMessage } from '../../shared/utils/errors';

const props = defineProps<{
  selectedWorkspaceId?: string | null;
}>();

const emit = defineEmits<{
  (event: 'update:selectedWorkspaceId', value: string | null): void;
}>();

const electronAPI = window.electronAPI;

const showWorkspaceSelector = ref(false);
const loadingWorkspaces = ref(false);
const workspaceLoadError = ref('');
const availableWorkspaces = ref<Workspace[]>([]);
const workspaceSelectorCloseTimer = ref<number | null>(null);

const normalizeWorkspaceId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeWorkspace = (value: unknown): Workspace | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<Workspace>;
  if (typeof record.id !== 'string' || record.id.trim().length === 0) return null;
  if (typeof record.path !== 'string' || record.path.trim().length === 0) return null;
  if (typeof record.name !== 'string' || record.name.trim().length === 0) return null;

  return {
    id: record.id,
    path: record.path,
    name: record.name,
    is_temporary: typeof record.is_temporary === 'number' ? record.is_temporary : 0,
    show_in_list: typeof record.show_in_list === 'number' ? record.show_in_list : 1,
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
  };
};

const normalizeWorkspaces = (value: unknown): Workspace[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: Workspace[] = [];

  for (const entry of value) {
    const workspace = normalizeWorkspace(entry);
    if (!workspace || seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    normalized.push(workspace);
  }

  return normalized;
};

const selectedWorkspaceId = computed(() => normalizeWorkspaceId(props.selectedWorkspaceId));
const selectedWorkspace = computed(
  () =>
    availableWorkspaces.value.find(workspace => workspace.id === selectedWorkspaceId.value) ?? null
);
const hasWorkspaceSelection = computed(() => selectedWorkspaceId.value !== null);
const isWorkspaceSelectorActive = computed(
  () => hasWorkspaceSelection.value || availableWorkspaces.value.length > 0
);
const workspaceBadgeLabel = computed(() => {
  return hasWorkspaceSelection.value ? '1' : '';
});
const triggerTitle = computed(() => {
  if (selectedWorkspace.value) {
    return `${selectedWorkspace.value.name} · ${selectedWorkspace.value.path}`;
  }
  if (hasWorkspaceSelection.value) {
    return 'Selected workspace';
  }
  return 'Choose a workspace for this thread';
});

const loadWorkspaces = async () => {
  loadingWorkspaces.value = true;
  workspaceLoadError.value = '';

  try {
    const visibleWorkspaces = normalizeWorkspaces(await electronAPI?.workspaces?.getVisible?.());
    const currentWorkspaceId = selectedWorkspaceId.value;

    if (!currentWorkspaceId || visibleWorkspaces.some(workspace => workspace.id === currentWorkspaceId)) {
      availableWorkspaces.value = visibleWorkspaces;
      return;
    }

    const currentWorkspace = normalizeWorkspace(
      await electronAPI?.workspaces?.get?.(currentWorkspaceId)
    );
    availableWorkspaces.value = currentWorkspace
      ? [currentWorkspace, ...visibleWorkspaces.filter(workspace => workspace.id !== currentWorkspace.id)]
      : visibleWorkspaces;
  } catch (error) {
    availableWorkspaces.value = [];
    workspaceLoadError.value = `Failed to load workspaces: ${getErrorMessage(error)}`;
  } finally {
    loadingWorkspaces.value = false;
  }
};

const openWorkspaceSelector = () => {
  if (workspaceSelectorCloseTimer.value !== null) {
    window.clearTimeout(workspaceSelectorCloseTimer.value);
    workspaceSelectorCloseTimer.value = null;
  }
  showWorkspaceSelector.value = true;
};

const scheduleCloseWorkspaceSelector = () => {
  if (workspaceSelectorCloseTimer.value !== null) {
    window.clearTimeout(workspaceSelectorCloseTimer.value);
  }
  workspaceSelectorCloseTimer.value = window.setTimeout(() => {
    showWorkspaceSelector.value = false;
    workspaceSelectorCloseTimer.value = null;
  }, 180);
};

const toggleWorkspaceSelector = () => {
  showWorkspaceSelector.value = !showWorkspaceSelector.value;
  if (showWorkspaceSelector.value) {
    void loadWorkspaces();
  }
};

const selectWorkspace = (workspaceId: string | null) => {
  emit('update:selectedWorkspaceId', normalizeWorkspaceId(workspaceId));
  showWorkspaceSelector.value = false;
};

watch(selectedWorkspaceId, () => {
  void loadWorkspaces();
});

onMounted(() => {
  void loadWorkspaces();
});

onUnmounted(() => {
  if (workspaceSelectorCloseTimer.value !== null) {
    window.clearTimeout(workspaceSelectorCloseTimer.value);
    workspaceSelectorCloseTimer.value = null;
  }
});
</script>

<style scoped>
.workspace-selector-panel {
  width: 360px;
}

.workspace-selector-refresh {
  flex-shrink: 0;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .workspace-selector-panel {
    width: min(360px, calc(100vw - 32px));
  }
}
</style>
