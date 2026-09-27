<template>
  <div
    ref="scroll"
    class="ledger-scroll ui-scrollbar min-h-0 min-w-0 flex-1 overflow-auto"
    @scroll="onScroll"
    @click.self="emit('select', null)"
  >
    <p v-if="matches && !visibleCount" class="ui-text-muted p-4 text-xs" role="status">
      {{ t('chat.runs.noMatches') }}
    </p>
    <section
      v-for="ledger in ledgers"
      :key="ledger.run.id"
      :aria-label="t('chat.runs.turn', { n: ledger.turn })"
    >
      <template v-if="!matches || visibleEntries(ledger).length">
        <div class="ledger-run flex h-8 items-center gap-2 px-2">
          <button
            type="button"
            class="trajectory-control flex min-w-0 items-center gap-1"
            :aria-expanded="!collapsed.has(ledger.run.id)"
            @click="emit('toggleRun', ledger.run.id)"
          >
            <ChevronRight :size="12" :class="{ 'rotate-90': !collapsed.has(ledger.run.id) }" />
            <span>{{ t('chat.runs.turn', { n: ledger.turn }) }}</span>
          </button>
          <span class="truncate text-[11px] ui-text-muted"
            >{{ t(`chat.runs.runKind.${ledger.run.kind}`) }} · {{ ledger.run.model }}</span
          >
          <span
            class="ml-auto shrink-0 text-[11px]"
            :class="ledger.run.status === 'failed' ? 'ui-text-danger' : 'ui-text-muted'"
            >{{ t(`chat.runs.status.${ledger.run.status}`) }}</span
          >
          <button
            type="button"
            class="trajectory-control"
            :aria-label="t('chat.runs.inspectRun')"
            @click="emit('inspectRun', ledger.run.id)"
          >
            <Ellipsis :size="14" />
          </button>
        </div>
        <div v-if="collapsed.has(ledger.run.id) && !matches" class="px-8 py-1">
          <button
            type="button"
            class="trajectory-control"
            @click="emit('toggleRun', ledger.run.id)"
          >
            {{ t('chat.runs.folded', { count: ledger.entries.length }) }}
          </button>
        </div>
        <template v-else>
          <button
            v-for="entry in visibleEntries(ledger)"
            :key="entry.id"
            :ref="el => register(entry.id, el)"
            type="button"
            class="ledger-row flex w-full min-w-0 items-center gap-2 px-2 text-left"
            :data-record-id="entry.id"
            :data-kind="entry.type"
            :data-error="entry.isError || undefined"
            :aria-pressed="entry.id === selectedId"
            :class="{
              'is-selected': entry.id === selectedId,
              'is-dimmed': focusedIds !== null && !focusedIds.has(entry.id),
            }"
            @click="emit('select', entry.id)"
            @keydown="navigate($event, entry.id)"
          >
            <span class="w-5 shrink-0 text-right text-[10px] ui-text-muted">{{
              entry.index || ''
            }}</span>
            <span class="trajectory-tag shrink-0" :data-kind="entry.type">{{
              t(`chat.runs.kind.${entry.type}`)
            }}</span>
            <span class="min-w-0 flex-1 truncate text-xs">{{
              entry.type === 'system'
                ? t('chat.runs.systemPrompt')
                : entry.summary.replace(/\s+/g, ' ') || t('chat.runs.trace.empty')
            }}</span>
            <span v-if="entry.isError" class="ui-text-danger shrink-0 text-[11px]">{{
              t('chat.runs.step.failed')
            }}</span>
          </button>
        </template>
      </template>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue';
import { ChevronRight, Ellipsis } from 'lucide-vue-next';
import { useI18n } from '../../i18n';
import type { LedgerEntry, TurnLedger } from '../../modules/run/trajectory_ledger';
const props = defineProps<{
  ledgers: TurnLedger[];
  selectedId: string | null;
  collapsed: Set<string>;
  hideTools: boolean;
  matches: Set<string> | null;
  focusedIds: Set<string> | null;
}>();
const emit = defineEmits<{
  select: [id: string | null];
  toggleRun: [id: string];
  inspectRun: [id: string];
}>();
const { t } = useI18n();
const scroll = ref<HTMLElement | null>(null);
const rows = new Map<string, HTMLElement>();
let followTail = true;
const register = (id: string, element: Element | ComponentPublicInstance | null) => {
  if (element instanceof HTMLElement) rows.set(id, element);
  else rows.delete(id);
};
const visibleEntries = (ledger: TurnLedger): LedgerEntry[] =>
  ledger.entries.filter(
    entry =>
      (!props.matches || props.matches.has(entry.id)) &&
      (!props.hideTools || entry.lane !== 2 || entry.id === props.selectedId)
  );
const visibleCount = computed(() =>
  props.ledgers.reduce((count, ledger) => count + visibleEntries(ledger).length, 0)
);
const onScroll = () => {
  if (scroll.value)
    followTail =
      scroll.value.scrollHeight - scroll.value.scrollTop - scroll.value.clientHeight < 40;
};
watch(
  () => props.selectedId,
  async id => {
    if (!id) return;
    followTail = false;
    await nextTick();
    rows.get(id)?.scrollIntoView?.({ block: 'nearest' });
  }
);
watch(
  visibleCount,
  async () => {
    if (!followTail || props.selectedId || props.matches) return;
    await nextTick();
    if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight;
  },
  { immediate: true }
);
const navigate = (event: KeyboardEvent, id: string) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const ids = props.ledgers
    .filter(ledger => !props.collapsed.has(ledger.run.id) || props.matches)
    .flatMap(ledger => visibleEntries(ledger).map(entry => entry.id));
  const current = ids.indexOf(id);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? ids.length - 1
        : Math.max(0, Math.min(ids.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
  if (!ids[next]) return;
  event.preventDefault();
  rows.get(ids[next])?.focus();
  emit('select', ids[next]);
};
</script>
<style scoped>
.ledger-run {
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}
.ledger-row {
  height: 29px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 40%, transparent);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.ledger-row:hover {
  background: var(--bg-hover);
}
.ledger-row.is-selected {
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
}
.ledger-row.is-dimmed {
  opacity: 0.35;
}
.ledger-row:focus-visible {
  outline: 1px solid var(--accent-color);
  outline-offset: -1px;
}
</style>
