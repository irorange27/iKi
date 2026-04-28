<template>
  <div v-if="props.visible" class="run-panel">
    <div class="run-panel-header">
      <span class="run-panel-title ui-text-primary">{{ t('chat.runs.title') }}</span>
      <button
        class="run-panel-close-btn"
        type="button"
        :aria-label="t('common.close')"
        @click="$emit('close')"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="loading" class="run-panel-state ui-text-muted">
      {{ t('chat.runs.loading') }}
    </div>
    <div v-else-if="runs.length === 0" class="run-panel-state ui-text-muted">
      {{ t('chat.runs.empty') }}
    </div>
    <div v-else class="run-list ui-scrollbar">
      <div
        v-for="run in runs"
        :key="run.id"
        class="run-item"
        :class="`run-item--${run.status}`"
      >
        <div class="run-item-top">
          <span class="run-item-kind">{{ run.kind }}</span>
          <span class="run-item-status" :class="`run-status--${run.status}`">{{ run.status }}</span>
        </div>
        <div class="run-item-meta">
          <span class="run-item-model">{{ run.model }}</span>
          <span class="run-item-time">{{ formatTime(run.createdAt) }}</span>
        </div>
        <div v-if="run.error" class="run-item-error ui-text-danger">
          {{ run.error.message }}
        </div>
        <div class="run-item-actions">
          <button
            v-if="run.status === 'running' || run.status === 'blocked'"
            class="run-action-btn run-action-cancel"
            :disabled="actionLoading === run.id"
            @click="handleCancel(run.id)"
          >
            {{ t('chat.runs.cancel') }}
          </button>
          <button
            v-if="run.status === 'blocked'"
            class="run-action-btn run-action-resume"
            :disabled="actionLoading === run.id"
            @click="handleResume(run.id)"
          >
            {{ t('chat.runs.resume') }}
          </button>
          <button
            v-if="run.status === 'failed'"
            class="run-action-btn run-action-retry"
            :disabled="actionLoading === run.id"
            @click="handleRetry(run.id)"
          >
            {{ t('chat.runs.retry') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { AgentRun } from '../../shared/types/agent_run';
import type { ElectronApi } from '../../shared/types/electron_api';

const props = defineProps<{
  visible: boolean;
  threadId: string | null;
  electronAPI: Pick<ElectronApi, 'chat'>;
}>();

defineEmits<{
  (event: 'close'): void;
}>();

const runs = ref<AgentRun[]>([]);
const loading = ref(false);
const actionLoading = ref<string | null>(null);

const loadRuns = async () => {
  if (!props.threadId) {
    runs.value = [];
    return;
  }
  loading.value = true;
  try {
    const result = await props.electronAPI.chat.runs.list(props.threadId);
    runs.value = result ?? [];
  } catch {
    runs.value = [];
  } finally {
    loading.value = false;
  }
};

watch(() => props.visible, async (v) => {
  if (v) await loadRuns();
});

watch(() => props.threadId, async () => {
  if (props.visible) await loadRuns();
});

onMounted(async () => {
  if (props.visible) await loadRuns();
});

const handleCancel = async (runId: string) => {
  actionLoading.value = runId;
  try {
    await props.electronAPI.chat.runs.cancel(runId);
    await loadRuns();
  } finally {
    actionLoading.value = null;
  }
};

const handleResume = async (runId: string) => {
  actionLoading.value = runId;
  try {
    await props.electronAPI.chat.runs.resume(runId);
    await loadRuns();
  } finally {
    actionLoading.value = null;
  }
};

const handleRetry = async (runId: string) => {
  actionLoading.value = runId;
  try {
    await props.electronAPI.chat.runs.retry(runId);
    await loadRuns();
  } finally {
    actionLoading.value = null;
  }
};

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const t = (_key: string) => {
  const strings: Record<string, string> = {
    'chat.runs.title': 'Run History',
    'chat.runs.loading': 'Loading runs...',
    'chat.runs.empty': 'No runs in this thread yet.',
    'chat.runs.cancel': 'Cancel',
    'chat.runs.resume': 'Resume',
    'chat.runs.retry': 'Retry',
    'common.close': 'Close',
  };
  return strings[_key] || _key;
};
</script>

<style scoped>
.run-panel {
  display: flex;
  flex-direction: column;
  width: 300px;
  min-width: 280px;
  max-width: 360px;
  height: 100%;
  border-left: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.run-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}

.run-panel-title {
  font-size: 13px;
  font-weight: 650;
}

.run-panel-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.run-panel-close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.run-panel-state {
  padding: 24px 14px;
  font-size: 12px;
  text-align: center;
}

.run-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-item {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.run-item--running {
  border-left: 3px solid var(--accent-color);
}

.run-item--blocked {
  border-left: 3px solid var(--warning-color);
}

.run-item--failed {
  border-left: 3px solid var(--status-danger-color);
}

.run-item--completed {
  border-left: 3px solid var(--status-success-color);
}

.run-item--cancelled {
  opacity: 0.7;
}

.run-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.run-item-kind {
  font-size: 11px;
  font-weight: 650;
  color: var(--text-primary);
}

.run-item-status {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
}

.run-status--running {
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.12);
}

.run-status--blocked {
  color: var(--warning-color);
  background: rgba(var(--warning-rgb, 255 193 7), 0.12);
}

.run-status--completed {
  color: var(--status-success-color);
  background: rgba(var(--status-success-rgb, 76 175 80), 0.12);
}

.run-status--failed {
  color: var(--status-danger-color);
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.12);
}

.run-status--cancelled {
  color: var(--text-muted);
  background: rgba(var(--text-secondary-rgb, 158 158 158), 0.1);
}

.run-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.run-item-model {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.run-item-time {
  opacity: 0.7;
}

.run-item-error {
  font-size: 11px;
  margin-bottom: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.06);
}

.run-item-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.run-action-btn {
  padding: 3px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  transition: all 0.18s ease;
}

.run-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.run-action-cancel {
  color: var(--status-danger-color);
  border-color: rgba(var(--status-danger-rgb, 244 67 54), 0.25);
}

.run-action-cancel:hover:not(:disabled) {
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.08);
}

.run-action-resume {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb), 0.25);
}

.run-action-resume:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.08);
}

.run-action-retry {
  color: var(--warning-color);
  border-color: rgba(var(--warning-rgb, 255 193 7), 0.25);
}

.run-action-retry:hover:not(:disabled) {
  background: rgba(var(--warning-rgb, 255 193 7), 0.08);
}
</style>
