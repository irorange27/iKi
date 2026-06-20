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
        <div class="run-item-top" @click="toggleDetail(run.id)">
          <span class="run-item-kind">{{ run.kind }}</span>
          <span class="run-item-status" :class="`run-status--${run.status}`">{{ run.status }}</span>
        </div>
        <div class="run-item-meta" @click="toggleDetail(run.id)">
          <span class="run-item-model">{{ run.model }}</span>
          <span class="run-item-time">{{ formatTime(run.createdAt) }}</span>
        </div>
        <div v-if="run.error" class="run-item-error ui-text-danger">
          {{ run.error.message }}
        </div>

        <!-- Lifecycle actions -->
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

        <!-- Eval actions -->
        <div class="run-item-actions eval-actions">
          <button
            class="run-action-btn run-action-export"
            @click="handleExport(run.id)"
          >
            {{ t('chat.eval.export') }}
          </button>
          <button
            v-if="baselineRunId !== run.id"
            class="run-action-btn run-action-baseline"
            @click="baselineRunId = run.id"
          >
            {{ t('chat.eval.selectBaseline') }}
          </button>
          <button
            v-if="baselineRunId && baselineRunId !== run.id"
            class="run-action-btn run-action-compare"
            @click="handleCompare(baselineRunId, run.id)"
          >
            {{ t('chat.eval.compare') }}
          </button>
        </div>

        <!-- Expanded detail: steps + labels -->
        <div v-if="expandedRunId === run.id" class="run-detail">
          <div v-if="detailLoading" class="run-detail-loading ui-text-muted">
            {{ t('chat.runs.loading') }}
          </div>
          <div
            v-for="step in detailSteps"
            :key="step.id"
            class="run-detail-step"
          >
            <div class="step-header">
              <span class="step-index">#{{ step.stepIndex }}</span>
              <span class="step-type">{{ step.type }}</span>
              <span class="step-status" :class="`step-status--${step.status}`">{{ step.status }}</span>
            </div>
            <div class="step-summary">{{ step.summary }}</div>

            <!-- Labels for this step -->
            <div class="step-labels">
              <span
                v-for="label in getStepLabels(step.stepIndex)"
                :key="label.id"
                class="step-label-chip"
                :class="`label-chip--${label.label}`"
              >
                {{ t(`chat.eval.label.${label.label}`) }}
                <button
                  class="label-chip-delete"
                  @click="handleDeleteLabel(label.id)"
                >&times;</button>
              </span>
            </div>

            <!-- Label buttons -->
            <div class="step-label-actions">
              <button
                class="step-label-btn"
                :class="{ active: hasLabel(step.stepIndex, 'correct') }"
                @click="handleLabel(run.id, step.id, step.stepIndex, 'correct')"
              >{{ t('chat.eval.label.correct') }}</button>
              <button
                class="step-label-btn"
                :class="{ active: hasLabel(step.stepIndex, 'incorrect') }"
                @click="handleLabel(run.id, step.id, step.stepIndex, 'incorrect')"
              >{{ t('chat.eval.label.incorrect') }}</button>
              <button
                class="step-label-btn"
                :class="{ active: hasLabel(step.stepIndex, 'partial') }"
                @click="handleLabel(run.id, step.id, step.stepIndex, 'partial')"
              >{{ t('chat.eval.label.partial') }}</button>
            </div>

            <!-- Note input -->
            <textarea
              v-if="noteInputs[step.stepIndex] !== undefined || getStepLabels(step.stepIndex).some(l => l.label === 'note')"
              class="step-note-input"
              :placeholder="t('chat.eval.label.note')"
              :value="noteInputs[step.stepIndex] ?? getStepLabels(step.stepIndex).find(l => l.label === 'note')?.note ?? ''"
              @input="handleNoteInput(step.stepIndex, ($event.target as HTMLTextAreaElement).value)"
              @blur="handleNoteBlur(run.id, step.id, step.stepIndex)"
              rows="2"
            />
            <button
              v-else
              class="step-note-toggle"
              @click="noteInputs[step.stepIndex] = ''"
            >+ {{ t('chat.eval.label.note') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Comparison modal -->
    <RunCompareView
      v-if="comparisonData"
      :comparison="comparisonData"
      :t="t"
      @close="comparisonData = null"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import type { AgentEvalComparison, AgentEvalLabel, AgentEvalLabelType, AgentRun, AgentRunStep } from '@iki/backend/types/agent_run';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import RunCompareView from './RunCompareView.vue';

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

const expandedRunId = ref<string | null>(null);
const detailSteps = ref<AgentRunStep[]>([]);
const detailLoading = ref(false);
const detailLabels = ref<AgentEvalLabel[]>([]);

const baselineRunId = ref<string | null>(null);
const comparisonData = ref<AgentEvalComparison | null>(null);
const noteInputs = reactive<Record<number, string>>({});

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

const loadTrace = async (runId: string) => {
  detailLoading.value = true;
  try {
    const trace = await props.electronAPI.chat.runs.getTrace(runId);
    detailSteps.value = trace?.steps ?? [];
    const labels = await props.electronAPI.chat.runs.eval.listLabels(runId);
    detailLabels.value = labels;
  } catch {
    detailSteps.value = [];
    detailLabels.value = [];
  } finally {
    detailLoading.value = false;
  }
};

const toggleDetail = async (runId: string) => {
  if (expandedRunId.value === runId) {
    expandedRunId.value = null;
  } else {
    expandedRunId.value = runId;
    await loadTrace(runId);
  }
};

const getStepLabels = (stepIndex: number): AgentEvalLabel[] => {
  const steps = detailSteps.value;
  const step = steps.find(s => s.stepIndex === stepIndex);
  if (!step) return [];
  return detailLabels.value.filter(l => l.stepId === step.id || l.stepId === null);
};

const hasLabel = (stepIndex: number, labelType: AgentEvalLabelType): boolean => {
  return getStepLabels(stepIndex).some(l => l.label === labelType);
};

const handleLabel = async (runId: string, stepId: string, stepIndex: number, labelType: string) => {
  try {
    const existing = detailLabels.value.filter(l => l.stepId === stepId && l.label === labelType);
    if (existing.length > 0) {
      for (const label of existing) {
        await props.electronAPI.chat.runs.eval.deleteLabel(label.id);
      }
      detailLabels.value = detailLabels.value.filter(l => !existing.includes(l as AgentEvalLabel));
    } else {
      const label = await props.electronAPI.chat.runs.eval.addLabel({
        runId,
        stepId,
        label: labelType,
      });
      detailLabels.value = [...detailLabels.value, label];
    }
  } catch {
    // ignore
  }
};

const handleDeleteLabel = async (labelId: string) => {
  try {
    await props.electronAPI.chat.runs.eval.deleteLabel(labelId);
    detailLabels.value = detailLabels.value.filter(l => l.id !== labelId);
  } catch {
    // ignore
  }
};

const handleNoteInput = (stepIndex: number, value: string) => {
  noteInputs[stepIndex] = value;
};

const handleNoteBlur = async (runId: string, stepId: string, stepIndex: number) => {
  const text = noteInputs[stepIndex];
  if (text === undefined) return;

  try {
    const existing = detailLabels.value.filter(l => l.stepId === stepId && l.label === 'note');
    if (existing.length > 0) {
      // update existing note
      for (const label of existing) {
        await props.electronAPI.chat.runs.eval.deleteLabel(label.id);
      }
    }
    if (text.trim()) {
      const label = await props.electronAPI.chat.runs.eval.addLabel({
        runId,
        stepId,
        label: 'note',
        note: text,
      });
      detailLabels.value = [...detailLabels.value.filter(l => !existing.includes(l as AgentEvalLabel)), label];
    } else {
      detailLabels.value = detailLabels.value.filter(l => !existing.includes(l as AgentEvalLabel));
    }
  } catch {
    // ignore
  }
  delete noteInputs[stepIndex];
};

const handleExport = async (runId: string) => {
  try {
    await props.electronAPI.chat.runs.eval.exportTrace(runId);
  } catch {
    // ignore
  }
};

const handleCompare = async (baselineId: string, testId: string) => {
  try {
    const result = await props.electronAPI.chat.runs.eval.compareRuns(baselineId, testId);
    comparisonData.value = result;
  } catch {
    // ignore
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
    'chat.eval.export': 'Export',
    'chat.eval.compare': 'Compare',
    'chat.eval.selectBaseline': 'Set as Baseline',
    'chat.eval.label.correct': 'Correct',
    'chat.eval.label.incorrect': 'Incorrect',
    'chat.eval.label.partial': 'Partial',
    'chat.eval.label.note': 'Note',
    'chat.eval.regression.pass': 'Pass',
    'chat.eval.regression.fail': 'Fail',
    'chat.eval.regression.pending': 'Pending',
    'chat.eval.compare.same': 'Same',
    'chat.eval.compare.different': 'Different',
    'chat.eval.compare.missing': 'Missing',
    'common.close': 'Close',
  };
  return strings[_key] || _key;
};
</script>

<style scoped>
.run-panel {
  display: flex;
  flex-direction: column;
  width: 320px;
  min-width: 300px;
  max-width: 400px;
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
  cursor: pointer;
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
  cursor: pointer;
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
  flex-wrap: wrap;
}

.eval-actions {
  border-top: 1px solid var(--border-color);
  padding-top: 6px;
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

.run-action-export {
  color: var(--text-secondary);
  border-color: rgba(var(--text-secondary-rgb, 158 158 158), 0.25);
}

.run-action-export:hover:not(:disabled) {
  background: rgba(var(--text-secondary-rgb, 158 158 158), 0.08);
}

.run-action-baseline {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb), 0.2);
}

.run-action-baseline:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.06);
}

.run-action-compare {
  color: var(--status-success-color);
  border-color: rgba(var(--status-success-rgb, 76 175 80), 0.25);
}

.run-action-compare:hover:not(:disabled) {
  background: rgba(var(--status-success-rgb, 76 175 80), 0.08);
}

/* Step detail */
.run-detail {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.run-detail-loading {
  font-size: 11px;
  padding: 8px 0;
  text-align: center;
}

.run-detail-step {
  padding: 6px 8px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.step-index {
  font-size: 10px;
  font-weight: 650;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.step-type {
  font-size: 10px;
  font-weight: 550;
  color: var(--text-primary);
}

.step-status {
  font-size: 9px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 999px;
  margin-left: auto;
}

.step-status--started {
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.1);
}

.step-status--completed {
  color: var(--status-success-color);
  background: rgba(var(--status-success-rgb, 76 175 80), 0.1);
}

.step-status--failed {
  color: var(--status-danger-color);
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.1);
}

.step-summary {
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 4px;
  line-height: 1.4;
  word-break: break-word;
}

.step-labels {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.step-label-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
}

.label-chip--correct {
  color: var(--status-success-color);
  background: rgba(var(--status-success-rgb, 76 175 80), 0.12);
}

.label-chip--incorrect {
  color: var(--status-danger-color);
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.12);
}

.label-chip--partial {
  color: var(--warning-color);
  background: rgba(var(--warning-rgb, 255 193 7), 0.12);
}

.label-chip--note {
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.1);
}

.label-chip-delete {
  border: 0;
  background: none;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  line-height: 1;
  color: inherit;
  opacity: 0.6;
}

.label-chip-delete:hover {
  opacity: 1;
}

.step-label-actions {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.step-label-btn {
  padding: 1px 8px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: transparent;
  font-size: 9px;
  font-weight: 550;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.18s ease;
}

.step-label-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.step-label-btn.active {
  color: var(--text-primary);
  border-color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.08);
}

.step-note-toggle {
  border: 0;
  background: none;
  font-size: 9px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}

.step-note-toggle:hover {
  color: var(--text-primary);
}

.step-note-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 10px;
  font-family: inherit;
  padding: 4px 8px;
  resize: vertical;
}

.step-note-input::placeholder {
  color: var(--text-muted);
}
</style>
