<template>
  <div
    class="workspace-selector-root relative"
    @mouseenter="openWorkspaceSelector"
    @mouseleave="scheduleCloseWorkspaceSelector"
  >
    <button
      class="workspace-selector-trigger composer-control-btn composer-selector-trigger ui-text-secondary relative flex h-10 w-10 items-center justify-center rounded-[14px]"
      :class="{ 'ui-text-accent': isWorkspaceSelectorActive }"
      :title="triggerTitle"
      :aria-label="triggerTitle"
      :disabled="isLocked"
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
      <span v-if="workspaceBadgeLabel" class="selector-badge workspace-selector-badge">
        {{ workspaceBadgeLabel }}
      </span>
    </button>

    <div v-if="showWorkspaceTip" class="workspace-selector-tip" role="tooltip">
      <div class="workspace-selector-tip-title ui-text-primary">
        {{ selectedWorkspace?.name }}
      </div>
      <div class="workspace-selector-tip-path ui-text-secondary">
        {{ selectedWorkspace?.path }}
      </div>
      <div v-if="workspaceTipMetaLines.length > 0" class="workspace-selector-tip-meta ui-text-muted">
        <div v-for="(line, idx) in workspaceTipMetaLines" :key="idx">
          {{ line }}
        </div>
      </div>
      <div v-if="workspaceTipNote" class="workspace-selector-tip-divider" />
      <div v-if="workspaceTipNote" class="workspace-selector-tip-note ui-text-secondary">
        {{ workspaceTipNote }}
      </div>
    </div>

    <div
      v-if="showWorkspaceSelector"
      class="selector-panel workspace-selector-panel"
      @mouseenter="openWorkspaceSelector"
      @mouseleave="scheduleCloseWorkspaceSelector"
    >
      <div class="selector-panel-header">
        <div class="flex items-center justify-between gap-3">
          <span class="selector-panel-title ui-text-primary">{{ t('chat.workspace.title') }}</span>
          <div class="workspace-selector-header-actions">
            <button
              class="selector-action-btn workspace-selector-add"
              :disabled="loadingWorkspaces || isPickingDirectory"
              @click.stop="pickWorkspaceDirectory"
            >
              {{ isPickingDirectory ? t('chat.workspace.adding') : t('common.addFolder') }}
            </button>
            <button
              class="selector-icon-btn workspace-selector-refresh flex h-8 w-8 items-center justify-center rounded-[10px]"
              :disabled="loadingWorkspaces || isPickingDirectory"
              :title="t('chat.workspace.refreshTitle')"
              :aria-label="t('chat.workspace.refreshTitle')"
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
        </div>
        <div class="selector-panel-description ui-text-muted">
          {{ t('chat.workspace.description') }}
        </div>
      </div>

      <div class="selector-list">
        <button
          class="selector-item"
          :class="{ 'selector-item-selected': !selectedWorkspaceId }"
          @click="selectWorkspace(null)"
        >
          <div class="selector-item-copy">
            <span class="font-medium">{{ t('chat.workspace.noWorkspace') }}</span>
            <span class="selector-item-description selector-item-description-wide">
              {{ t('chat.workspace.noWorkspaceDescription') }}
            </span>
          </div>
          <div class="selector-check" :class="{ 'selector-check-active': !selectedWorkspaceId }">
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

        <div v-if="loadingWorkspaces" class="selector-empty-state">
          {{ t('chat.workspace.loading') }}
        </div>
        <div v-else-if="workspaceLoadError" class="selector-empty-state">
          {{ workspaceLoadError }}
        </div>
        <div v-else-if="availableWorkspaces.length === 0" class="selector-empty-state">
          {{ t('chat.workspace.noneVisible') }}
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
              <span v-if="workspace.is_temporary === 1">
                · {{ t('chat.workspace.temporary') }}
              </span>
              <span v-if="workspace.show_in_list !== 1">
                · {{ t('chat.workspace.hiddenFromGlobal') }}
              </span>
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
import type { Workspace } from '@iki/backend/types/chat';
import { getErrorMessage } from '@iki/core/utils/errors';
import { useI18n } from '../i18n';
import { getElectronApiSliceMethod } from '../services/electron_api';

const props = defineProps<{
  selectedWorkspaceId?: string | null;
  locked?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:selectedWorkspaceId', value: string | null): void;
}>();

const getVisibleWorkspaces = getElectronApiSliceMethod('workspaces', 'getVisible');
const getWorkspace = getElectronApiSliceMethod('workspaces', 'get');
const pickWorkspaceDirectoryFromApi = getElectronApiSliceMethod('workspaces', 'pickDirectory');
const { t } = useI18n();
const SELECTOR_CLOSE_DELAY_MS = 320;

const showWorkspaceSelector = ref(false);
const isWorkspaceTriggerHovered = ref(false);
const loadingWorkspaces = ref(false);
const isPickingDirectory = ref(false);
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
const isLocked = computed(() => props.locked === true);
const selectedWorkspace = computed(
  () =>
    availableWorkspaces.value.find(workspace => workspace.id === selectedWorkspaceId.value) ?? null
);
const hasWorkspaceSelection = computed(() => selectedWorkspaceId.value !== null);
const currentWorkspaceIsTemporary = computed(() => selectedWorkspace.value?.is_temporary === 1);
const workspaceTipMetaLines = computed(() => {
  const lines: string[] = [];
  if (currentWorkspaceIsTemporary.value) {
    lines.push(t('chat.workspace.tempCompact'));
  }
  if (selectedWorkspace.value?.show_in_list !== 1) {
    lines.push(t('chat.workspace.hiddenFromGlobal'));
  }
  return lines;
});
const workspaceTipNote = computed(() =>
  isLocked.value ? t('chat.workspace.lockedNote') : ''
);
const showWorkspaceTip = computed(
  () =>
    isLocked.value &&
    isWorkspaceTriggerHovered.value &&
    Boolean(selectedWorkspace.value) &&
    !showWorkspaceSelector.value
);
const isWorkspaceSelectorActive = computed(
  () => hasWorkspaceSelection.value || availableWorkspaces.value.length > 0
);
const workspaceBadgeLabel = computed(() => {
  if (!hasWorkspaceSelection.value) return '';
  return currentWorkspaceIsTemporary.value ? 'T' : '1';
});
const triggerTitle = computed(() => {
  if (selectedWorkspace.value) {
    const titleParts = [`${selectedWorkspace.value.name} · ${selectedWorkspace.value.path}`];
    if (currentWorkspaceIsTemporary.value) {
      titleParts.push(t('chat.workspace.temporaryHint'));
    }
    if (isLocked.value) {
      titleParts.push(t('chat.workspace.lockedHint'));
    }
    return titleParts.join(' · ');
  }
  if (isLocked.value) return t('chat.workspace.lockedHint');
  if (hasWorkspaceSelection.value) {
    return t('chat.workspace.selected');
  }
  return t('chat.workspace.choose');
});

const loadWorkspaces = async () => {
  loadingWorkspaces.value = true;
  workspaceLoadError.value = '';

  try {
    const visibleWorkspaces = normalizeWorkspaces(
      getVisibleWorkspaces ? await getVisibleWorkspaces() : []
    );
    const currentWorkspaceId = selectedWorkspaceId.value;

    if (
      !currentWorkspaceId ||
      visibleWorkspaces.some(workspace => workspace.id === currentWorkspaceId)
    ) {
      availableWorkspaces.value = visibleWorkspaces;
      return;
    }

    const currentWorkspace = normalizeWorkspace(
      getWorkspace ? await getWorkspace(currentWorkspaceId) : null
    );
    availableWorkspaces.value = currentWorkspace
      ? [
          currentWorkspace,
          ...visibleWorkspaces.filter(workspace => workspace.id !== currentWorkspace.id),
        ]
      : visibleWorkspaces;
  } catch (error) {
    availableWorkspaces.value = [];
    workspaceLoadError.value = t('chat.workspace.loadFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    loadingWorkspaces.value = false;
  }
};

const openWorkspaceSelector = () => {
  isWorkspaceTriggerHovered.value = true;
  if (isLocked.value) return;
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
    isWorkspaceTriggerHovered.value = false;
    showWorkspaceSelector.value = false;
    workspaceSelectorCloseTimer.value = null;
  }, SELECTOR_CLOSE_DELAY_MS);
};

const toggleWorkspaceSelector = () => {
  if (isLocked.value) return;
  showWorkspaceSelector.value = !showWorkspaceSelector.value;
  if (showWorkspaceSelector.value) {
    void loadWorkspaces();
  }
};

const selectWorkspace = (workspaceId: string | null) => {
  if (isLocked.value) return;
  emit('update:selectedWorkspaceId', normalizeWorkspaceId(workspaceId));
  showWorkspaceSelector.value = false;
};

const pickWorkspaceDirectory = async () => {
  if (isLocked.value) return;
  isPickingDirectory.value = true;
  workspaceLoadError.value = '';

  try {
    const workspace = normalizeWorkspace(
      pickWorkspaceDirectoryFromApi ? await pickWorkspaceDirectoryFromApi() : null
    );
    await loadWorkspaces();
    if (workspace?.id) {
      emit('update:selectedWorkspaceId', workspace.id);
      showWorkspaceSelector.value = false;
    }
  } catch (error) {
    workspaceLoadError.value = t('chat.workspace.addFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    isPickingDirectory.value = false;
  }
};

watch(selectedWorkspaceId, () => {
  void loadWorkspaces();
});

watch(isLocked, locked => {
  if (!locked) return;
  showWorkspaceSelector.value = false;
  isWorkspaceTriggerHovered.value = false;
  if (workspaceSelectorCloseTimer.value !== null) {
    window.clearTimeout(workspaceSelectorCloseTimer.value);
    workspaceSelectorCloseTimer.value = null;
  }
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

.workspace-selector-tip {
  position: absolute;
  left: 0;
  bottom: 100%;
  z-index: 55;
  margin-bottom: 8px;
  width: min(320px, calc(100vw - 32px));
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
  box-shadow: var(--surface-shadow-lg);
  padding: 12px 14px;
}

.workspace-selector-tip-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}

.workspace-selector-tip-path,
.workspace-selector-tip-meta,
.workspace-selector-tip-note {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.workspace-selector-tip-divider {
  margin-top: 10px;
  border-top: 1px solid var(--border-color);
}

.workspace-selector-tip-note {
  margin-top: 10px;
}

.workspace-selector-badge {
  right: -5px;
  left: auto;
}

.workspace-selector-refresh {
  flex-shrink: 0;
}

.workspace-selector-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.workspace-selector-add {
  white-space: nowrap;
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
