<template>
  <div class="traj-root flex h-full min-h-0 min-w-0 flex-col" @keydown.esc.stop.prevent="escape">
    <div
      class="traj-toolbar flex min-h-8 shrink-0 flex-wrap items-center gap-1 px-2 py-1"
      role="toolbar"
      :aria-label="t('chat.runs.toolbar')"
    >
      <button
        type="button"
        class="trajectory-control flex items-center gap-1"
        :aria-pressed="mode === 'time'"
        :title="t('chat.runs.timeHint')"
        @click="
          mode = mode === 'time' ? 'sequence' : 'time';
          range = null;
        "
      >
        <Clock3 :size="12" />{{ t('chat.runs.time') }}
      </button>
      <button
        type="button"
        class="trajectory-control flex items-center gap-1"
        :aria-pressed="allCollapsed"
        @click="toggleAll"
      >
        <ListCollapse :size="12" />{{ t('chat.runs.runs') }}
      </button>
      <button
        type="button"
        class="trajectory-control flex items-center gap-1"
        :aria-pressed="hideTools"
        @click="hideTools = !hideTools"
      >
        <Wrench :size="12" />{{ t('chat.runs.calls') }}
      </button>
      <button v-if="range" type="button" class="trajectory-control" @click="range = null">
        {{ t('chat.runs.clearRange') }}
      </button>
      <span class="ml-auto text-[11px] ui-text-muted" role="status">{{
        loading ? t('chat.runs.refreshing') : t('chat.runs.recordCount', { count: entries.length })
      }}</span>
      <button
        type="button"
        class="trajectory-control"
        :aria-label="t('chat.runs.refresh')"
        :disabled="loading"
        @click="refresh"
      >
        <RefreshCw :size="12" />
      </button>
      <label class="traj-search flex w-40 items-center gap-1 px-1.5"
        ><Search :size="12" aria-hidden="true" /><input
          v-model="query"
          type="search"
          class="min-w-0 w-full py-0.5"
          :aria-label="t('chat.runs.search')"
          :placeholder="t('chat.runs.search')"
      /></label>
    </div>
    <p v-if="error || actionError" role="alert" class="ui-text-danger shrink-0 px-3 py-2 text-xs">
      {{ error || actionError }}
    </p>
    <p v-if="notice" role="status" class="ui-text-secondary shrink-0 px-3 py-1 text-xs">
      {{ notice }}
    </p>
    <div
      v-if="!ledgers.length"
      class="ui-text-muted flex flex-1 items-center justify-center p-6 text-xs"
      role="status"
    >
      {{
        loading ? t('chat.runs.loading') : error ? t('chat.runs.loadFailed') : t('chat.runs.empty')
      }}
    </div>
    <template v-else>
      <TrajectoryTiming
        :items="timeline"
        :mode="mode"
        :selected-id="selectedId"
        :range="range"
        :matches="matches"
        @select="select"
        @range-change="range = $event"
      />
      <div
        ref="split"
        class="traj-split relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        :class="{ 'has-detail': selectedTurn }"
      >
        <TrajectoryLedger
          :ledgers="ledgers"
          :selected-id="selectedId"
          :collapsed="collapsed"
          :hide-tools="hideTools"
          :matches="matches"
          :focused-ids="focusedIds"
          @select="select"
          @toggle-run="toggleRun"
          @inspect-run="inspectRun"
        />
        <template v-if="selectedTurn">
          <div
            role="separator"
            tabindex="0"
            aria-orientation="vertical"
            :aria-label="t('chat.runs.resizeDetails')"
            :aria-valuenow="detailWidth"
            :aria-valuemin="30"
            :aria-valuemax="65"
            class="traj-resize w-1 shrink-0 touch-none cursor-col-resize"
            @pointerdown="resizeStart"
            @pointermove="resizeMove"
            @pointerup="resizeEnd"
            @pointercancel="resizing = false"
            @lostpointercapture="resizing = false"
            @dblclick="detailWidth = 38"
            @keydown="resizeKey"
          />
          <TrajectoryDetail
            :entry="selectedEntry"
            :ledger="selectedTurn"
            :electronAPI="electronAPI"
            :busy="actionBusy"
            :style="{ '--detail-width': `${detailWidth}%` }"
            @close="select(null)"
            @back="emit('close')"
            @action="runAction"
          />
        </template>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { Clock3, ListCollapse, RefreshCw, Search, Wrench } from 'lucide-vue-next';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { useI18n } from '../i18n';
import { useTrajectory } from '../composables/useTrajectory';
import TrajectoryTiming from '../components/run/TrajectoryTiming.vue';
import TrajectoryLedger from '../components/run/TrajectoryLedger.vue';
import TrajectoryDetail from '../components/run/TrajectoryDetail.vue';
import {
  buildTurnLedgers,
  intersectsRange,
  projectTimeline,
  type TimelineMode,
  type TimelineRange,
} from '../modules/run/trajectory_ledger';
const props = defineProps<{ threadId: string | null; electronAPI: Pick<ElectronApi, 'chat'> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { traces, loading, error, refresh } = useTrajectory(
  toRef(props, 'threadId'),
  props.electronAPI
);
const selectedId = ref<string | null>(null);
const selectedRunId = ref<string | null>(null);
const range = ref<TimelineRange | null>(null);
const mode = ref<TimelineMode>('sequence');
const query = ref('');
const hideTools = ref(false);
const collapsed = ref(new Set<string>());
const split = ref<HTMLElement | null>(null);
const detailWidth = ref(38);
const resizing = ref(false);
const actionBusy = ref(false);
const actionError = ref('');
const notice = ref('');
const ledgers = computed(() => buildTurnLedgers(traces.value));
const entries = computed(() => ledgers.value.flatMap(ledger => ledger.entries));
const selectedEntry = computed(
  () => entries.value.find(entry => entry.id === selectedId.value) ?? null
);
const selectedTurn = computed(
  () =>
    ledgers.value.find(
      ledger =>
        ledger.run.id === selectedRunId.value ||
        ledger.entries.some(entry => entry.id === selectedId.value)
    ) ?? null
);
const timeline = computed(() => projectTimeline(entries.value, mode.value));
const matches = computed(() =>
  query.value.trim()
    ? new Set(
        entries.value
          .filter(entry => entry.searchText.includes(query.value.trim().toLocaleLowerCase()))
          .map(entry => entry.id)
      )
    : null
);
const focusedIds = computed(() =>
  range.value
    ? new Set(
        timeline.value
          .filter(item => intersectsRange(item, range.value as TimelineRange))
          .map(item => item.entry.id)
      )
    : null
);
const allCollapsed = computed(
  () =>
    ledgers.value.length > 0 && ledgers.value.every(ledger => collapsed.value.has(ledger.run.id))
);
const toggleRun = (id: string) => {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
};
const toggleAll = () => {
  collapsed.value = allCollapsed.value
    ? new Set()
    : new Set(ledgers.value.map(ledger => ledger.run.id));
};
const select = (id: string | null) => {
  selectedRunId.value = null;
  if (id) {
    const ledger = ledgers.value.find(item => item.entries.some(entry => entry.id === id));
    if (ledger && collapsed.value.has(ledger.run.id)) toggleRun(ledger.run.id);
    if (matches.value && !matches.value.has(id)) query.value = '';
  }
  selectedId.value = id;
};
const inspectRun = (id: string) => {
  selectedId.value = null;
  selectedRunId.value = id;
};
const escape = () => {
  if (range.value) range.value = null;
  else if (selectedTurn.value) select(null);
  else query.value = '';
};
watch(
  () => props.threadId,
  () => {
    selectedId.value = null;
    selectedRunId.value = null;
    range.value = null;
    collapsed.value = new Set();
    query.value = '';
    notice.value = '';
    actionError.value = '';
  },
  { flush: 'sync' }
);
const resizeStart = (event: PointerEvent) => {
  if (event.button !== 0) return;
  resizing.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
};
const resizeMove = (event: PointerEvent) => {
  const rect = split.value?.getBoundingClientRect();
  if (resizing.value && rect)
    detailWidth.value = Math.round(
      Math.min(65, Math.max(30, ((rect.right - event.clientX) / rect.width) * 100))
    );
};
const resizeEnd = (event: PointerEvent) => {
  resizing.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
};
const resizeKey = (event: KeyboardEvent) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  detailWidth.value =
    event.key === 'Home'
      ? 38
      : Math.min(65, Math.max(30, detailWidth.value + (event.key === 'ArrowLeft' ? 5 : -5)));
};
const runAction = async (action: 'cancel' | 'retry' | 'export', runId: string) => {
  if (actionBusy.value) return;
  const threadId = props.threadId;
  actionBusy.value = true;
  actionError.value = '';
  notice.value = '';
  try {
    const api = props.electronAPI.chat.runs;
    const result =
      action === 'cancel'
        ? await api.cancel(runId)
        : action === 'retry'
          ? await api.retryAndExecute(runId)
          : await api.eval.exportTrace(runId);
    if (props.threadId !== threadId) return;
    if (!result.success) {
      if (result.error) throw new Error(result.error);
      if (action !== 'export') throw new Error(t('chat.runs.actionFailed'));
    } else if (action === 'export') notice.value = t('chat.runs.exported');
    await refresh();
  } catch (cause) {
    if (props.threadId === threadId) actionError.value = getErrorMessage(cause);
  } finally {
    actionBusy.value = false;
  }
};
</script>
