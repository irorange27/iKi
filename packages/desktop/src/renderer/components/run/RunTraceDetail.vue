<template>
  <div class="run-detail">
    <div v-if="detailLoading" class="run-detail-loading ui-text-muted">
      {{ t('chat.runs.loading') }}
    </div>
    <template v-else>
      <div
        v-if="detailTrajectory?.final_metrics"
        class="run-trace-metrics"
      >
        <span
          v-if="detailTrajectory.final_metrics.total_prompt_tokens !== undefined"
          class="run-trace-metric"
        >
          ↑ {{ detailTrajectory.final_metrics.total_prompt_tokens }} tok
        </span>
        <span
          v-if="detailTrajectory.final_metrics.total_completion_tokens !== undefined"
          class="run-trace-metric"
        >
          ↓ {{ detailTrajectory.final_metrics.total_completion_tokens }} tok
        </span>
        <span
          v-if="detailTrajectory.final_metrics.total_cached_tokens !== undefined"
          class="run-trace-metric"
        >
          cache {{ detailTrajectory.final_metrics.total_cached_tokens }}
        </span>
        <span
          v-if="detailTrajectory.final_metrics.total_cost_usd !== undefined"
          class="run-trace-metric"
        >
          ${{ detailTrajectory.final_metrics.total_cost_usd.toFixed(4) }}
        </span>
        <span
          v-if="detailTrajectory.final_metrics.total_steps !== undefined"
          class="run-trace-metric"
        >
          {{ detailTrajectory.final_metrics.total_steps }} steps
        </span>
      </div>

      <div
        v-for="step in detailTrajectory?.steps ?? []"
        :key="step.step_id"
        class="run-detail-step"
      >
        <div class="step-header">
          <span class="step-index">#{{ step.step_id }}</span>
          <span
            class="run-trace-source"
            :class="`run-trace-source--${step.source}`"
          >{{ step.source }}</span>
          <span class="run-trace-time">{{ formatTraceTime(step.timestamp) }}</span>
        </div>

        <div v-if="step.message" class="run-trace-message">{{ step.message }}</div>

        <details v-if="step.reasoning_content" class="run-trace-collapsible">
          <summary>{{ t('chat.runs.trace.reasoning') }}</summary>
          <div class="run-trace-reasoning">{{ step.reasoning_content }}</div>
        </details>

        <details
          v-for="call in step.tool_calls ?? []"
          :key="call.tool_call_id"
          class="run-trace-collapsible"
          open
        >
          <summary>
            <span class="run-trace-tool-name">{{ call.function_name }}</span>
          </summary>
          <pre
            v-if="call.arguments !== undefined"
            class="run-trace-json">{{ formatTraceJson(call.arguments) }}</pre>
        </details>

        <details v-if="step.observation" class="run-trace-collapsible">
          <summary>{{ t('chat.runs.trace.observation') }}</summary>
          <pre class="run-trace-json">{{ formatObservation(step.observation) }}</pre>
        </details>

        <div
          v-if="step.metrics && Object.keys(step.metrics).length > 0"
          class="run-trace-metrics run-trace-metrics--step"
        >
          <span
            v-for="(value, metricKey) in step.metrics"
            :key="metricKey"
            class="run-trace-metric"
          >
            {{ metricKey }}: {{ value }}
          </span>
        </div>

        <!-- Labels for this step (bound to the backing internal step) -->
        <template v-if="getInternalStep(step)">
          <div class="step-labels">
            <span
              v-for="label in getStepLabels(getInternalStep(step)!.stepIndex)"
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
              :class="{ active: hasLabel(getInternalStep(step)!.stepIndex, 'correct') }"
              @click="handleLabel(run.id, getInternalStep(step)!.id, getInternalStep(step)!.stepIndex, 'correct')"
            >{{ t('chat.eval.label.correct') }}</button>
            <button
              class="step-label-btn"
              :class="{ active: hasLabel(getInternalStep(step)!.stepIndex, 'incorrect') }"
              @click="handleLabel(run.id, getInternalStep(step)!.id, getInternalStep(step)!.stepIndex, 'incorrect')"
            >{{ t('chat.eval.label.incorrect') }}</button>
            <button
              class="step-label-btn"
              :class="{ active: hasLabel(getInternalStep(step)!.stepIndex, 'partial') }"
              @click="handleLabel(run.id, getInternalStep(step)!.id, getInternalStep(step)!.stepIndex, 'partial')"
            >{{ t('chat.eval.label.partial') }}</button>
          </div>

          <!-- Note input -->
          <textarea
            v-if="noteInputs[getInternalStep(step)!.stepIndex] !== undefined || getStepLabels(getInternalStep(step)!.stepIndex).some(l => l.label === 'note')"
            class="step-note-input"
            :placeholder="t('chat.eval.label.note')"
            :value="noteInputs[getInternalStep(step)!.stepIndex] ?? getStepLabels(getInternalStep(step)!.stepIndex).find(l => l.label === 'note')?.note ?? ''"
            @input="handleNoteInput(getInternalStep(step)!.stepIndex, ($event.target as HTMLTextAreaElement).value)"
            @blur="handleNoteBlur(run.id, getInternalStep(step)!.id, getInternalStep(step)!.stepIndex)"
            rows="2"
          />
          <button
            v-else
            class="step-note-toggle"
            @click="noteInputs[getInternalStep(step)!.stepIndex] = ''"
          >+ {{ t('chat.eval.label.note') }}</button>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { AgentEvalLabel, AgentEvalLabelType, AgentRun, AgentRunStep } from '@iki/backend/types/agent_run';
import type { AtifStep, AtifTrajectory } from '@iki/backend/types/atif';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { useI18n } from '../../i18n';

const props = defineProps<{
  run: AgentRun;
  electronAPI: Pick<ElectronApi, 'chat'>;
}>();

const { t } = useI18n();

const detailSteps = ref<AgentRunStep[]>([]);
const detailTrajectory = ref<AtifTrajectory | null>(null);
const detailLoading = ref(false);
const detailLabels = ref<AgentEvalLabel[]>([]);
const noteInputs = reactive<Record<number, string>>({});

const loadTrace = async () => {
  detailLoading.value = true;
  try {
    const [trace, trajectory, labels] = await Promise.all([
      props.electronAPI.chat.runs.getTrace(props.run.id),
      props.electronAPI.chat.runs.trajectory(props.run.id),
      props.electronAPI.chat.runs.eval.listLabels(props.run.id),
    ]);
    detailSteps.value = trace?.steps ?? [];
    detailTrajectory.value = trajectory;
    detailLabels.value = labels;
  } catch {
    detailSteps.value = [];
    detailTrajectory.value = null;
    detailLabels.value = [];
  } finally {
    detailLoading.value = false;
  }
};

/** Internal step backing an ATIF step (labels/notes bind to run step indexes). */
const getInternalStep = (step: AtifStep): AgentRunStep | undefined => {
  const rawIndex = (step.extra as Record<string, unknown> | undefined)?.run_step_index;
  const stepIndex = typeof rawIndex === 'number' ? rawIndex : Number.NaN;
  if (!Number.isFinite(stepIndex)) return undefined;
  return detailSteps.value.find(candidate => candidate.stepIndex === stepIndex);
};

const formatTraceTime = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
};

const formatTraceJson = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatObservation = (observation: NonNullable<AtifStep['observation']>): string => {
  const results = observation.results ?? [];
  return results.map(result => formatTraceJson(result.content)).join('\n\n---\n\n');
};

const getStepLabels = (stepIndex: number): AgentEvalLabel[] => {
  const step = detailSteps.value.find(candidate => candidate.stepIndex === stepIndex);
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

onMounted(() => {
  void loadTrace();
});
</script>

<style scoped>
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
  font-family: var(--font-mono);
}

.run-trace-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.run-trace-metrics--step {
  margin-bottom: 0;
  margin-top: 6px;
}

.run-trace-metric {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.run-trace-source {
  border-radius: 999px;
  padding: 0 7px;
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.run-trace-source--user {
  background: rgba(var(--accent-rgb), 0.14);
  color: var(--accent-color);
}

.run-trace-source--agent {
  background: color-mix(in srgb, var(--success-color) 16%, transparent);
  color: var(--success-color);
}

.run-trace-source--system {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.run-trace-time {
  margin-left: auto;
  font-size: 9px;
  color: var(--text-muted);
}

.run-trace-message {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.run-trace-collapsible {
  margin-top: 6px;
}

.run-trace-collapsible summary {
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
}

.run-trace-collapsible summary:hover {
  color: var(--text-secondary);
}

.run-trace-tool-name {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.run-trace-reasoning {
  margin-top: 4px;
  padding: 6px 8px;
  border-left: 2px solid var(--border-color);
  font-size: 10px;
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.run-trace-json {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  font-size: 10px;
  line-height: 1.5;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow-y: auto;
}

.step-labels {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 4px;
  margin-top: 6px;
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
  background: color-mix(in srgb, var(--status-success-color) 12%, transparent);
}

.label-chip--incorrect {
  color: var(--status-danger-color);
  background: color-mix(in srgb, var(--status-danger-color) 12%, transparent);
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
  cursor: pointer;
  color: var(--text-muted);
  padding: 0;
}

.step-note-toggle:hover {
  color: var(--text-primary);
}

.step-note-input {
  width: 100%;
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
