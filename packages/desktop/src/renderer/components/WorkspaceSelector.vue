<template>
  <div class="workspace-selector" :class="{ 'workspace-selector--empty': !selectedWorkspace }">
    <FolderOpen class="workspace-selector-icon" :size="14" aria-hidden="true" />

    <select
      class="workspace-selector-select"
      :value="selectedId ?? ''"
      :aria-label="t('chat.workspace.selectorLabel')"
      :title="selectedWorkspace?.path ?? t('chat.workspace.noWorkspace')"
      @change="selectWorkspace(($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">{{ t('chat.workspace.noWorkspace') }}</option>
      <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
        {{ workspace.name }}
      </option>
    </select>

    <button
      class="workspace-selector-browse"
      type="button"
      :disabled="isPicking"
      :aria-label="t('chat.workspace.browse')"
      :title="t('chat.workspace.browse')"
      @click="pickWorkspace"
    >
      <FolderPlus :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { FolderOpen, FolderPlus } from 'lucide-vue-next';

import type { Workspace } from '@iki/backend/types/chat';
import { useI18n } from '../i18n';
import { getOptionalElectronAPI } from '../services/electron_api';
import { useThreadSessionStore } from '../store/thread_session';

/**
 * Workspace picker at the top-left of the chat column, outside the composer.
 *
 * It states where tools will run, and it is the only thing that can say so
 * before a message exists: a chat with no workspace tells the model it has a
 * working directory while file and shell tools have nowhere to run.
 *
 * Selecting with no active thread stages the choice (thread creation picks it
 * up); with a thread it rebinds that thread immediately.
 */
const { t } = useI18n();
const electronAPI = getOptionalElectronAPI();
const threadSession = useThreadSessionStore();

const workspaces = ref<Workspace[]>([]);
const isPicking = ref(false);

const selectedId = computed(() => threadSession.selectedWorkspaceId ?? null);
const selectedWorkspace = computed(
  () => workspaces.value.find(workspace => workspace.id === selectedId.value) ?? null
);

const selectWorkspace = (workspaceId: string | null) => {
  void threadSession.setWorkspace(workspaceId?.trim() || null);
};

const pickWorkspace = async () => {
  if (!electronAPI?.workspaces?.pickDirectory) return;
  isPicking.value = true;
  try {
    const picked = await electronAPI.workspaces.pickDirectory();
    if (!picked) return;
    if (!workspaces.value.some(workspace => workspace.id === picked.id)) {
      workspaces.value = [...workspaces.value, picked];
    }
    selectWorkspace(picked.id);
  } catch {
    // A cancelled or failed native dialog leaves the previous choice intact.
  } finally {
    isPicking.value = false;
  }
};

const loadWorkspaces = async () => {
  try {
    const listed = await electronAPI?.workspaces?.getVisible?.();
    workspaces.value = (Array.isArray(listed) ? listed : []).filter(
      workspace => workspace.is_temporary !== 1
    );
  } catch {
    workspaces.value = [];
  }
};

onMounted(loadWorkspaces);
</script>

<style scoped>
.workspace-selector {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 280px;
  height: 24px;
  padding: 0 2px 0 6px;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: background-color 0.15s ease;
}

.workspace-selector:hover {
  background: var(--bg-hover);
}

.workspace-selector-icon {
  flex: none;
  opacity: 0.75;
}

.workspace-selector-select {
  min-width: 0;
  max-width: 200px;
  height: 22px;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  /* The native control's own chrome would break the header's quiet line. */
  appearance: none;
  text-overflow: ellipsis;
}

.workspace-selector-select:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 60%, transparent);
  outline-offset: 1px;
  border-radius: 4px;
}

/* No workspace chosen: the control keeps its place but recedes, so the header
   rhythm does not jump once one is picked. */
.workspace-selector--empty {
  color: var(--text-tertiary);
}

.workspace-selector-browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease;
}

.workspace-selector:hover .workspace-selector-browse,
.workspace-selector-browse:focus-visible {
  opacity: 1;
}

.workspace-selector-browse:hover {
  color: var(--text-primary);
}

.workspace-selector-browse:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
