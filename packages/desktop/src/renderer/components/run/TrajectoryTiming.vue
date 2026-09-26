<template>
  <section class="timing-root shrink-0" :aria-label="t('chat.runs.timing.title')">
    <div class="grid h-[50px] grid-cols-[44px_minmax(0,1fr)] overflow-hidden">
      <div class="timing-labels relative" aria-hidden="true">
        <span
          v-for="(key, lane) in laneKeys"
          :key="key"
          class="absolute right-1"
          :style="{ top: `${5 + lane * 14}px` }"
          >{{ t(key) }}</span
        >
      </div>
      <div
        ref="track"
        class="relative min-w-0 overflow-hidden touch-none select-none"
        :class="drag?.pan ? 'cursor-grabbing' : 'cursor-crosshair'"
        @pointerdown="pointerDown"
        @pointermove="pointerMove"
        @pointerup="pointerUp"
        @pointercancel="
          drag = null;
          draft = null;
        "
        @lostpointercapture="
          drag = null;
          draft = null;
        "
        @dblclick="reset"
        @contextmenu.prevent
        @wheel.prevent="zoom"
      >
        <button
          v-for="item in visibleItems"
          :key="item.entry.id"
          type="button"
          class="timing-bar absolute"
          :data-record-id="item.entry.id"
          :data-kind="item.entry.type"
          :data-error="item.entry.isError || undefined"
          :aria-label="`${t(`chat.runs.kind.${item.entry.type}`)}: ${
            item.entry.type === 'system'
              ? t('chat.runs.systemPrompt')
              : item.entry.summary.replace(/\s+/g, ' ').slice(0, 160)
          }`"
          :aria-pressed="selectedId === item.entry.id"
          :class="{ 'is-selected': selectedId === item.entry.id, 'is-dimmed': dimmed(item) }"
          :style="barStyle(item)"
          :title="`${t(`chat.runs.kind.${item.entry.type}`)} · ${new Date(item.entry.startedMs).toLocaleString()}\n${item.entry.summary.slice(0, 240)}`"
          @click="keyboardSelect($event, item.entry.id)"
        />
        <div
          v-if="draft || range"
          class="timing-selection pointer-events-none absolute inset-y-0"
          :style="rangeStyle((draft || range)!)"
        />
      </div>
    </div>
    <button
      v-if="viewport"
      type="button"
      class="trajectory-control absolute right-1 top-0"
      @click="reset"
    >
      {{ t('chat.runs.resetZoom') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '../../i18n';
import {
  intersectsRange,
  type TimelineItem,
  type TimelineMode,
  type TimelineRange,
} from '../../modules/run/trajectory_ledger';
const props = defineProps<{
  items: TimelineItem[];
  mode: TimelineMode;
  selectedId: string | null;
  range: TimelineRange | null;
  matches: Set<string> | null;
}>();
const emit = defineEmits<{ select: [id: string]; rangeChange: [range: TimelineRange | null] }>();
const { t } = useI18n();
const laneKeys = ['chat.runs.lane.event', 'chat.runs.lane.model', 'chat.runs.lane.tool'] as const;
const track = ref<HTMLElement | null>(null);
const viewport = ref<TimelineRange | null>(null);
const draft = ref<TimelineRange | null>(null);
const drag = ref<{
  x: number;
  at: number;
  id: string | null;
  pan: boolean;
  view: TimelineRange;
  pointerId: number;
} | null>(null);
const domainEnd = computed(() => Math.max(1, ...props.items.map(item => item.end)));
const view = computed(() => viewport.value ?? { start: 0, end: domainEnd.value });
const visibleItems = computed(() => props.items.filter(item => intersectsRange(item, view.value)));
const fractionAt = (x: number) => {
  const rect = track.value?.getBoundingClientRect();
  return rect ? Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width))) : 0;
};
const at = (x: number) => view.value.start + fractionAt(x) * (view.value.end - view.value.start);
const pct = (value: number) =>
  ((value - view.value.start) / (view.value.end - view.value.start)) * 100;
const barStyle = (item: TimelineItem) => ({
  top: `${7 + item.entry.lane * 14}px`,
  left: `${Math.min(99.6, Math.max(0, pct(item.start)))}%`,
  width: `max(3px, calc(${Math.max(0, Math.min(100, pct(item.end)) - Math.max(0, pct(item.start)))}% - 2px))`,
});
const rangeStyle = (value: TimelineRange) => ({
  left: `${Math.max(0, pct(value.start))}%`,
  width: `${Math.max(0, Math.min(100, pct(value.end)) - Math.max(0, pct(value.start)))}%`,
});
const dimmed = (item: TimelineItem) =>
  (props.range && !intersectsRange(item, props.range)) ||
  (props.matches && !props.matches.has(item.entry.id));
const reset = () => {
  viewport.value = null;
  emit('rangeChange', null);
};
watch(() => props.mode, reset);
watch(domainEnd, end => {
  if (viewport.value && viewport.value.start >= end) viewport.value = null;
});
const select = (id: string) => {
  emit('rangeChange', null);
  emit('select', id);
};
const keyboardSelect = (event: MouseEvent, id: string) => {
  if (event.detail === 0) select(id);
};
const pointerDown = (event: PointerEvent) => {
  if (event.button !== 0 && event.button !== 2) return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-record-id]');
  drag.value = {
    x: event.clientX,
    at: at(event.clientX),
    id: target?.dataset.recordId ?? null,
    pan: event.button === 2,
    view: { ...view.value },
    pointerId: event.pointerId,
  };
  track.value?.setPointerCapture?.(event.pointerId);
};
const boundedView = (start: number, size: number) => {
  const nextStart = Math.max(0, Math.min(domainEnd.value - size, start));
  return { start: nextStart, end: nextStart + size };
};
const pointerMove = (event: PointerEvent) => {
  const from = drag.value;
  if (!from || Math.abs(event.clientX - from.x) < 3) return;
  if (from.pan) {
    const size = from.view.end - from.view.start;
    viewport.value = boundedView(
      from.view.start -
        ((event.clientX - from.x) / Math.max(1, track.value?.clientWidth ?? 1)) * size,
      size
    );
  } else {
    const current = at(event.clientX);
    draft.value = { start: Math.min(from.at, current), end: Math.max(from.at, current) };
  }
};
const pointerUp = (event: PointerEvent) => {
  const from = drag.value;
  if (!from) return;
  const selection = draft.value;
  const moved = Math.abs(event.clientX - from.x) >= 3;
  drag.value = null;
  draft.value = null;
  track.value?.releasePointerCapture?.(event.pointerId);
  if (from.pan) {
    if (!moved) emit('rangeChange', null);
    return;
  }
  if (selection && moved) {
    emit('rangeChange', selection);
    return;
  }
  if (from.id) {
    select(from.id);
    return;
  }
  const nearest = props.items.reduce<TimelineItem | null>(
    (best, item) =>
      !best || Math.abs(item.start - from.at) < Math.abs(best.start - from.at) ? item : best,
    null
  );
  if (nearest) select(nearest.entry.id);
};
const zoom = (event: WheelEvent) => {
  const oldSize = view.value.end - view.value.start;
  const minimum = Math.min(domainEnd.value, props.mode === 'sequence' ? 4 : 20);
  const size = Math.min(
    domainEnd.value,
    Math.max(minimum, oldSize * Math.exp(event.deltaY * 0.002))
  );
  viewport.value =
    size >= domainEnd.value
      ? null
      : boundedView(at(event.clientX) - fractionAt(event.clientX) * size, size);
};
</script>

<style scoped>
.timing-root {
  position: relative;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}
.timing-labels {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 12px;
}
.timing-bar {
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--trajectory-color, var(--accent-color));
  cursor: pointer;
}
.timing-bar:hover,
.timing-bar.is-selected {
  outline: 1px solid var(--text-primary);
  outline-offset: 1px;
}
.timing-bar.is-dimmed {
  opacity: 0.2;
}
.timing-bar:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
.timing-selection {
  background: color-mix(in srgb, var(--accent-color) 15%, transparent);
  border: 1px solid var(--accent-color);
}
</style>
