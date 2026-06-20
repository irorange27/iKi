<template>
  <div class="compare-overlay" @click.self="$emit('close')">
    <div class="compare-modal">
      <div class="compare-header">
        <span class="compare-title">Run Comparison</span>
        <button class="compare-close-btn" @click="$emit('close')">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Side-by-side headers -->
      <div class="compare-columns">
        <div class="compare-col">
          <div class="compare-col-header">
            <span class="col-label">Baseline</span>
            <span class="col-model">{{ comparison.runA.run.model }}</span>
            <span class="col-meta">{{ comparison.totalStepsA }} steps</span>
          </div>
        </div>
        <div class="compare-col">
          <div class="compare-col-header">
            <span class="col-label">Test</span>
            <span class="col-model">{{ comparison.runB.run.model }}</span>
            <span class="col-meta">{{ comparison.totalStepsB }} steps</span>
          </div>
        </div>
      </div>

      <!-- Step-by-step rows -->
      <div class="compare-body ui-scrollbar">
        <div
          v-for="entry in comparison.stepComparison"
          :key="entry.stepIndex"
          class="compare-row"
          :class="{ 'compare-row--mismatch': !entry.match }"
        >
          <div class="compare-col">
            <div v-if="entry.baselineStep" class="compare-step">
              <div class="compare-step-head">
                <span class="compare-step-idx">#{{ entry.stepIndex }}</span>
                <span class="compare-step-type">{{ entry.baselineStep.type }}</span>
                <span class="compare-step-status" :class="`cmp-status--${entry.baselineStep.status}`">
                  {{ entry.baselineStep.status }}
                </span>
              </div>
              <div class="compare-step-summary">{{ entry.baselineStep.summary }}</div>
              <div v-if="entry.labels.length > 0" class="compare-step-labels">
                <span
                  v-for="label in entry.labels"
                  :key="label.id"
                  class="compare-label-chip"
                  :class="`label-chip--${label.label}`"
                >{{ t(`chat.eval.label.${label.label}`) }}</span>
              </div>
            </div>
            <div v-else class="compare-step compare-step--missing">
              {{ t('chat.eval.compare.missing') }}
            </div>
          </div>
          <div class="compare-col">
            <div v-if="entry.comparisonStep" class="compare-step">
              <div class="compare-step-head">
                <span class="compare-step-idx">#{{ entry.stepIndex }}</span>
                <span class="compare-step-type">{{ entry.comparisonStep.type }}</span>
                <span class="compare-step-status" :class="`cmp-status--${entry.comparisonStep.status}`">
                  {{ entry.comparisonStep.status }}
                </span>
              </div>
              <div class="compare-step-summary">{{ entry.comparisonStep.summary }}</div>
            </div>
            <div v-else class="compare-step compare-step--missing">
              {{ t('chat.eval.compare.missing') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Match indicator -->
      <div class="compare-footer">
        <span class="compare-match-indicator">
          <span v-if="comparison.stepComparison.every(e => e.match)" class="match-badge match-badge--pass">
            {{ t('chat.eval.regression.pass') }}
          </span>
          <span v-else class="match-badge match-badge--fail">
            {{ t('chat.eval.regression.fail') }} — {{ mismatchCount }} step{{ mismatchCount === 1 ? '' : 's' }} differ
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentEvalComparison } from '@iki/backend/types/agent_run';

const props = defineProps<{
  comparison: AgentEvalComparison;
  t: (key: string) => string;
}>();

defineEmits<{
  (event: 'close'): void;
}>();

const mismatchCount = computed(() =>
  props.comparison.stepComparison.filter(e => !e.match).length
);
</script>

<style scoped>
.compare-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.compare-modal {
  width: 720px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.compare-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.compare-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}

.compare-close-btn {
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

.compare-close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.compare-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.compare-col-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  border-bottom: 1px solid var(--border-color);
}

.col-label {
  font-weight: 650;
  color: var(--text-primary);
}

.col-model {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-muted);
  font-size: 10px;
}

.col-meta {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
}

.compare-body {
  flex: 1;
  overflow-y: auto;
  max-height: 50vh;
}

.compare-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--border-color);
}

.compare-row--mismatch {
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.04);
}

.compare-col {
  padding: 6px 8px;
  border-right: 1px solid var(--border-color);
}

.compare-col:last-child {
  border-right: 0;
}

.compare-step {
  font-size: 10px;
}

.compare-step--missing {
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
  padding: 12px 0;
}

.compare-step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.compare-step-idx {
  font-size: 9px;
  font-weight: 650;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.compare-step-type {
  font-size: 9px;
  font-weight: 550;
  color: var(--text-primary);
}

.compare-step-status {
  font-size: 8px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 999px;
  margin-left: auto;
}

.cmp-status--completed {
  color: var(--status-success-color);
  background: rgba(var(--status-success-rgb, 76 175 80), 0.1);
}

.cmp-status--started {
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.1);
}

.cmp-status--failed {
  color: var(--status-danger-color);
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.1);
}

.compare-step-summary {
  font-size: 9px;
  color: var(--text-muted);
  line-height: 1.3;
  word-break: break-word;
}

.compare-step-labels {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  margin-top: 3px;
}

.compare-label-chip {
  font-size: 8px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 999px;
}

.compare-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.match-badge {
  font-size: 11px;
  font-weight: 650;
  padding: 2px 12px;
  border-radius: 999px;
}

.match-badge--pass {
  color: var(--status-success-color);
  background: rgba(var(--status-success-rgb, 76 175 80), 0.12);
}

.match-badge--fail {
  color: var(--status-danger-color);
  background: rgba(var(--status-danger-rgb, 244 67 54), 0.12);
}
</style>
