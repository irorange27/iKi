<template>
  <aside
    class="detail-pane flex min-h-0 min-w-0 flex-col"
    :aria-label="t('chat.runs.detail.title')"
  >
    <header class="detail-header flex h-10 shrink-0 items-center gap-2 px-3">
      <span class="trajectory-tag" :data-kind="entry?.type">{{
        entry ? t(`chat.runs.kind.${entry.type}`) : t('chat.runs.runs')
      }}</span>
      <span class="min-w-0 flex-1 truncate text-[11px] ui-text-muted"
        >{{ t('chat.runs.turn', { n: ledger.turn })
        }}<template v-if="entry?.step"> · #{{ entry.index }}</template></span
      >
      <button
        type="button"
        class="trajectory-control"
        :aria-label="t('chat.runs.closeDetails')"
        @click="emit('close')"
      >
        <X :size="16" />
      </button>
    </header>
    <div
      class="detail-tabs flex h-8 shrink-0 gap-1 overflow-x-auto px-2"
      role="tablist"
      :aria-label="t('chat.runs.detail.title')"
    >
      <button
        v-for="tab in tabs"
        :id="`trajectory-tab-${tab}`"
        :key="tab"
        type="button"
        role="tab"
        class="ui-tab shrink-0 px-2"
        :aria-selected="activeTab === tab"
        :tabindex="activeTab === tab ? 0 : -1"
        aria-controls="trajectory-detail-content"
        @click="activeTab = tab"
        @keydown="tabKey($event, tab)"
      >
        {{ t(`chat.runs.tab.${tab}`) }}
      </button>
    </div>
    <div
      id="trajectory-detail-content"
      class="ui-scrollbar min-h-0 flex-1 overflow-auto p-3"
      role="tabpanel"
      :aria-labelledby="`trajectory-tab-${activeTab}`"
      tabindex="0"
    >
      <template v-if="activeTab === 'summary'">
        <dl class="detail-facts grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt>{{ t('chat.runs.ledger.col.status') }}</dt>
          <dd :class="entry?.isError || ledger.run.status === 'failed' ? 'ui-text-danger' : ''">
            {{ t(`chat.runs.status.${ledger.run.status}`)
            }}<template v-if="entry?.step"> · {{ t(`chat.runs.step.${entry.status}`) }}</template>
          </dd>
          <dt>{{ t('chat.runs.model') }}</dt>
          <dd>{{ ledger.run.model }}</dd>
          <dt>{{ t('chat.runs.runType') }}</dt>
          <dd>{{ t(`chat.runs.runKind.${ledger.run.kind}`) }}</dd>
          <template v-if="ledger.run.parentRunId"
            ><dt>{{ t('chat.runs.parentRun') }}</dt>
            <dd class="detail-code">{{ ledger.run.parentRunId }}</dd></template
          >
        </dl>
        <div class="my-3 flex flex-wrap gap-2">
          <button
            v-if="['running', 'queued', 'blocked'].includes(ledger.run.status)"
            type="button"
            class="trajectory-control"
            :disabled="busy"
            @click="emit('action', 'cancel', ledger.run.id)"
          >
            {{ t('chat.runs.cancel') }}
          </button>
          <button
            v-if="ledger.run.status === 'blocked'"
            type="button"
            class="trajectory-control"
            :disabled="busy"
            @click="emit('back')"
          >
            {{ t('chat.runs.reviewApproval') }}
          </button>
          <button
            v-if="ledger.run.status === 'failed'"
            type="button"
            class="trajectory-control"
            :disabled="busy"
            @click="emit('action', 'retry', ledger.run.id)"
          >
            {{ t('chat.runs.retry') }}
          </button>
          <button
            type="button"
            class="trajectory-control"
            :disabled="busy"
            @click="emit('action', 'export', ledger.run.id)"
          >
            {{ t('chat.eval.export') }}
          </button>
        </div>
        <p
          v-if="ledger.run.error"
          class="ui-text-danger mb-3 whitespace-pre-wrap break-words text-xs"
        >
          {{ ledger.run.error.message }}
        </p>
        <h3 class="detail-heading">{{ t('chat.runs.ledger.col.summary') }}</h3>
        <pre class="detail-content">{{
          entry?.summary || ledger.run.output?.text || t(`chat.runs.status.${ledger.run.status}`)
        }}</pre>
        <details v-if="entry?.reasoning" class="mt-3">
          <summary class="detail-heading cursor-pointer">
            {{ t('chat.runs.trace.reasoning') }}
          </summary>
          <pre class="detail-content mt-2">{{ entry.reasoning }}</pre>
        </details>
        <template v-if="entry?.step">
          <h3 class="detail-heading mt-5">{{ t('chat.runs.evaluation') }}</h3>
          <p v-if="labelError" role="alert" class="ui-text-danger mb-2 text-xs">{{ labelError }}</p>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="option in labelOptions"
              :key="option"
              type="button"
              class="trajectory-control"
              :aria-pressed="stepLabels.some(label => label.label === option)"
              :disabled="labelBusy"
              @click="toggleLabel(option)"
            >
              {{ t(`chat.eval.label.${option}`) }}
            </button>
          </div>
          <label class="mt-3 block text-xs ui-text-secondary" for="trajectory-note">{{
            t('chat.eval.label.note')
          }}</label>
          <textarea
            id="trajectory-note"
            v-model="noteDraft"
            class="detail-note mt-1 w-full p-2 text-xs"
            rows="3"
            :disabled="labelBusy"
          />
          <button
            type="button"
            class="trajectory-control mt-1"
            :disabled="labelBusy || noteDraft === savedNote"
            @click="saveNote"
          >
            {{ t('common.save') }}
          </button>
        </template>
      </template>
      <pre v-else-if="activeTab === 'input'" class="detail-content detail-code">{{
        formatRecord(entry ? entry.input : ledger.run.input) || t('chat.runs.unavailable')
      }}</pre>
      <pre v-else-if="activeTab === 'output'" class="detail-content detail-code">{{
        formatRecord(entry ? entry.output : ledger.run.output) || t('chat.runs.unavailable')
      }}</pre>
      <template v-else-if="activeTab === 'timing'">
        <dl class="detail-facts grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
          <dt>{{ t('chat.runs.recordedAt') }}</dt>
          <dd>{{ new Date(entry?.startedMs ?? ledger.startedMs).toLocaleString() }}</dd>
          <template v-if="entry">
            <dt>{{ t('chat.runs.recordSpan') }}</dt>
            <dd>
              {{ entry.durationMs ? formatDuration(entry.durationMs) : t('chat.runs.unavailable') }}
            </dd>
          </template>
          <dt>{{ t('chat.runs.runSpan') }}</dt>
          <dd>{{ formatDuration(ledger.durationMs) }}</dd>
        </dl>
        <p class="mt-4 text-xs ui-text-muted">{{ t('chat.runs.timingNote') }}</p>
      </template>
      <pre v-else class="detail-content detail-code">{{
        formatRecord(
          entry
            ? (entry.step ?? { source: entry.type, runId: ledger.run.id, content: entry.input })
            : ledger.run
        )
      }}</pre>
    </div>
  </aside>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import type { AgentEvalLabel, AgentEvalLabelType } from '@iki/backend/types/agent_run';
import { getElectronAPI } from '../../services/electron_api';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { useI18n } from '../../i18n';
import {
  formatDuration,
  formatRecord,
  type LedgerEntry,
  type TurnLedger,
} from '../../modules/run/trajectory_ledger';
const electronAPI = getElectronAPI();
const props = defineProps<{
  entry: LedgerEntry | null;
  ledger: TurnLedger;
  busy: boolean;
}>();
const emit = defineEmits<{
  close: [];
  back: [];
  action: [action: 'cancel' | 'retry' | 'export', runId: string];
}>();
const { t } = useI18n();
const tabs = ['summary', 'input', 'output', 'timing', 'raw'] as const;
const activeTab = ref<(typeof tabs)[number]>('summary');
const tabKey = async (event: KeyboardEvent, tab: (typeof tabs)[number]) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  activeTab.value = tabs[index];
  await nextTick();
  document.getElementById(`trajectory-tab-${activeTab.value}`)?.focus();
};
const labelOptions: AgentEvalLabelType[] = ['correct', 'incorrect', 'partial'];
const labels = ref<AgentEvalLabel[]>([]);
const labelBusy = ref(false);
const labelError = ref('');
const noteDraft = ref('');
const stepLabels = computed(() =>
  labels.value.filter(label => label.stepId === props.entry?.step?.id)
);
const savedNote = computed(
  () => stepLabels.value.find(label => label.label === 'note')?.note ?? ''
);
let generation = 0;
watch(
  () => props.ledger.run.id,
  async runId => {
    const request = ++generation;
    labels.value = [];
    labelError.value = '';
    labelBusy.value = true;
    try {
      const result = await electronAPI.chat.runs.eval.listLabels(runId);
      if (request === generation) labels.value = result;
    } catch (error) {
      if (request === generation) labelError.value = getErrorMessage(error);
    } finally {
      if (request === generation) labelBusy.value = false;
    }
  },
  { immediate: true }
);
watch(
  [() => props.entry?.id, savedNote],
  () => {
    noteDraft.value = savedNote.value;
  },
  { immediate: true }
);
const changeLabels = async (operation: (runId: string, stepId: string) => Promise<void>) => {
  const stepId = props.entry?.step?.id;
  if (!stepId || labelBusy.value) return;
  const runId = props.ledger.run.id;
  const request = generation;
  labelBusy.value = true;
  labelError.value = '';
  try {
    await operation(runId, stepId);
    const result = await electronAPI.chat.runs.eval.listLabels(runId);
    if (request === generation) labels.value = result;
  } catch (error) {
    if (request === generation) labelError.value = getErrorMessage(error);
  } finally {
    if (request === generation) labelBusy.value = false;
  }
};
const remove = async (id: string) => {
  const result = await electronAPI.chat.runs.eval.deleteLabel(id);
  if (!result.success) throw new Error(t('chat.runs.actionFailed'));
};
const toggleLabel = (label: AgentEvalLabelType) => {
  const existing = stepLabels.value.filter(item => item.label === label);
  return changeLabels(async (runId, stepId) => {
    if (existing.length) {
      for (const item of existing) await remove(item.id);
    } else await electronAPI.chat.runs.eval.addLabel({ runId, stepId, label });
  });
};
const saveNote = () => {
  const note = noteDraft.value;
  const existing = stepLabels.value.filter(item => item.label === 'note');
  return changeLabels(async (runId, stepId) => {
    // Create before removing the old note: a failed write must not destroy it.
    if (note.trim())
      await electronAPI.chat.runs.eval.addLabel({ runId, stepId, label: 'note', note });
    for (const item of existing) await remove(item.id);
  });
};
</script>
<style scoped>
.detail-header,
.detail-tabs {
  border-bottom: 1px solid var(--border-color);
}
.detail-facts dt {
  color: var(--text-secondary);
}
.detail-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.detail-heading {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  margin-bottom: 6px;
}
.detail-content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
}
.detail-code {
  font-family: var(--font-mono);
  font-size: 11px;
}
.detail-note {
  border: 1px solid var(--border-color);
  border-radius: var(--control-radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  resize: vertical;
}
</style>
