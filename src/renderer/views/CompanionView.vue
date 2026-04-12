<template>
  <section
    class="companion-root"
    :class="{ 'companion-root-reduced': reduceMotion }"
    :data-phase="snapshot.phase"
  >
    <div class="companion-drag-strip" aria-hidden="true">
      <span class="companion-drag-notch" />
    </div>

    <component
      :is="surfaceTag"
      class="companion-surface"
      :class="{ 'companion-surface-clickable': canOpenMainWindow }"
      :type="surfaceTag === 'button' ? 'button' : undefined"
      @click="handleOpenMainWindow"
    >
      <div class="companion-signal" aria-hidden="true">
        <span class="companion-orbit" />
        <span class="companion-core" />
        <span class="companion-grid" />
      </div>

      <div class="companion-copy">
        <p class="companion-label">{{ snapshot.label }}</p>
        <h1 class="companion-headline">{{ snapshot.headline }}</h1>
        <p class="companion-detail">{{ snapshot.detail }}</p>
      </div>

      <div class="companion-footer">
        <span class="companion-phase">{{ phaseMeta }}</span>
        <span class="companion-updated">{{ updatedLabel }}</span>
      </div>

      <span v-if="canOpenMainWindow" class="companion-action">{{ actionLabel }}</span>
    </component>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { createLogger } from '../logger';
import { useConfigStore } from '../store/config';
import type { CompanionSnapshot } from '../../shared/types/companion';

const companionLogger = createLogger({ module: 'companion_view' });
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const electronAPI = window.electronAPI;
const VIEW_COPY = {
  en: {
    loadingHeadline: 'Loading companion state',
    loadingDetail: 'Waiting for the main process snapshot.',
    action: 'Open main chat',
    phaseMeta: {
      dormant: 'Standby',
      idle: 'Presence',
      thinking: 'Context',
      clarify: 'Question',
      co_plan: 'Joint step',
      stabilize: 'Pressure down',
      execute: 'Advance',
      nudge: 'Reminder',
    },
  },
  'zh-CN': {
    loadingHeadline: '正在载入 companion 状态',
    loadingDetail: '等待主进程同步当前快照。',
    action: '打开主聊天窗口',
    phaseMeta: {
      dormant: '待机',
      idle: '在场',
      thinking: '上下文',
      clarify: '提问',
      co_plan: '共拟下一步',
      stabilize: '降压',
      execute: '推进',
      nudge: '提醒',
    },
  },
} as const;

const locale = computed(() => (config.value.general.language === 'zh-CN' ? 'zh-CN' : 'en'));
const viewCopy = computed(() => VIEW_COPY[locale.value]);
const snapshot = ref<CompanionSnapshot>({
  phase: 'idle',
  label: 'iKi',
  headline: viewCopy.value.loadingHeadline,
  detail: viewCopy.value.loadingDetail,
  updatedAt: new Date().toISOString(),
});

const reduceMotion = computed(() => config.value.ui.companion.reduceMotion);
const canOpenMainWindow = computed(() => config.value.ui.companion.openMainWindowOnClick);
const surfaceTag = computed(() => (canOpenMainWindow.value ? 'button' : 'div'));
const phaseMeta = computed(() => viewCopy.value.phaseMeta[snapshot.value.phase]);
const actionLabel = computed(() => viewCopy.value.action);
const updatedLabel = computed(() => {
  const updatedAt = new Date(snapshot.value.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return '';

  const locale = config.value.general.language === 'zh-CN' ? 'zh-CN' : 'en';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(updatedAt);
});

const handleOpenMainWindow = async () => {
  if (!canOpenMainWindow.value) return;
  try {
    await electronAPI?.companion?.openMainWindow?.();
  } catch (error) {
    companionLogger.event({
      level: 'warn',
      event: 'companion.open_main_window',
      outcome: 'failed',
      error,
      message: 'Failed to open the main window from companion view.',
    });
  }
};

let removeCompanionListener: () => void = () => undefined;

onMounted(async () => {
  try {
    const nextSnapshot = await electronAPI?.companion?.getSnapshot?.();
    if (nextSnapshot) {
      snapshot.value = nextSnapshot;
    }
  } catch (error) {
    companionLogger.event({
      level: 'warn',
      event: 'companion.snapshot.load',
      outcome: 'failed',
      error,
      message: 'Failed to load initial companion snapshot.',
    });
  }

  removeCompanionListener =
    electronAPI?.companion?.onUpdated?.((nextSnapshot: CompanionSnapshot) => {
      snapshot.value = nextSnapshot;
    }) ?? (() => undefined);
});

onUnmounted(() => {
  removeCompanionListener();
});
</script>

<style scoped>
.companion-root {
  --companion-accent: oklch(0.7 0.11 220);
  --companion-accent-soft: color-mix(in oklch, var(--companion-accent) 22%, oklch(0.97 0.01 240));
  --companion-ink: color-mix(in oklch, var(--companion-accent) 18%, oklch(0.19 0.01 250));
  position: relative;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}

.companion-root[data-phase='dormant'] {
  --companion-accent: oklch(0.62 0.03 245);
}

.companion-root[data-phase='thinking'] {
  --companion-accent: oklch(0.71 0.12 225);
}

.companion-root[data-phase='clarify'] {
  --companion-accent: oklch(0.76 0.13 110);
}

.companion-root[data-phase='co_plan'] {
  --companion-accent: oklch(0.76 0.12 170);
}

.companion-root[data-phase='stabilize'] {
  --companion-accent: oklch(0.7 0.12 18);
}

.companion-root[data-phase='execute'] {
  --companion-accent: oklch(0.72 0.14 150);
}

.companion-root[data-phase='nudge'] {
  --companion-accent: oklch(0.8 0.12 85);
}

.companion-drag-strip {
  height: 20px;
  display: grid;
  place-items: center;
  -webkit-app-region: drag;
}

.companion-drag-notch {
  width: 52px;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--companion-accent) 24%, transparent);
}

.companion-surface {
  position: relative;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 14px;
  width: 100%;
  min-height: calc(100% - 20px);
  padding: 18px 18px 16px;
  border: 1px solid color-mix(in oklch, var(--companion-accent) 24%, rgba(255, 255, 255, 0.22));
  border-radius: 24px;
  background: linear-gradient(
    160deg,
    color-mix(in oklch, var(--companion-accent-soft) 76%, rgba(255, 255, 255, 0.86)),
    color-mix(in oklch, var(--companion-accent-soft) 32%, rgba(12, 18, 28, 0.08))
  );
  box-shadow:
    0 24px 44px rgba(9, 14, 24, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.55);
  color: var(--companion-ink);
  text-align: left;
  box-sizing: border-box;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.companion-surface::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(140deg, rgba(255, 255, 255, 0.24), transparent 42%),
    radial-gradient(
      circle at top right,
      color-mix(in oklch, var(--companion-accent) 18%, transparent),
      transparent 48%
    );
  pointer-events: none;
}

.companion-surface-clickable {
  cursor: pointer;
}

.companion-surface-clickable:hover {
  transform: translateY(-1px);
  box-shadow:
    0 28px 52px rgba(9, 14, 24, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.companion-surface-clickable:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 48%, white);
  outline-offset: 3px;
}

.companion-signal {
  position: relative;
  align-self: start;
  width: 72px;
  height: 72px;
  margin-top: 4px;
  border-radius: 22px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.7), transparent 30%),
    linear-gradient(
      155deg,
      color-mix(in oklch, var(--companion-accent) 24%, white),
      color-mix(in oklch, var(--companion-accent) 36%, rgba(18, 24, 36, 0.06))
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    inset 0 -12px 24px color-mix(in oklch, var(--companion-accent) 18%, transparent);
}

.companion-orbit,
.companion-core,
.companion-grid {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.companion-orbit {
  inset: 8px;
  border: 1px solid color-mix(in oklch, var(--companion-accent) 40%, rgba(255, 255, 255, 0.65));
  animation: companion-orbit 6.8s linear infinite;
}

.companion-core {
  inset: 22px;
  border-radius: 18px;
  background:
    radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.96), transparent 34%),
    radial-gradient(
      circle at center,
      color-mix(in oklch, var(--companion-accent) 38%, white),
      color-mix(in oklch, var(--companion-accent) 68%, rgba(16, 21, 32, 0.05))
    );
  box-shadow: 0 0 24px color-mix(in oklch, var(--companion-accent) 24%, transparent);
  animation: companion-breathe 3.2s ease-in-out infinite;
}

.companion-grid {
  background-image:
    linear-gradient(
      transparent 0,
      transparent calc(50% - 0.5px),
      color-mix(in oklch, var(--companion-accent) 18%, transparent) calc(50% - 0.5px),
      color-mix(in oklch, var(--companion-accent) 18%, transparent) calc(50% + 0.5px),
      transparent calc(50% + 0.5px),
      transparent 100%
    ),
    linear-gradient(
      90deg,
      transparent 0,
      transparent calc(50% - 0.5px),
      color-mix(in oklch, var(--companion-accent) 18%, transparent) calc(50% - 0.5px),
      color-mix(in oklch, var(--companion-accent) 18%, transparent) calc(50% + 0.5px),
      transparent calc(50% + 0.5px),
      transparent 100%
    );
  opacity: 0.8;
}

.companion-copy {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 6px;
  min-width: 0;
  padding-top: 4px;
}

.companion-label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 76%, white);
}

.companion-headline {
  margin: 0;
  font-size: 21px;
  line-height: 1.05;
  font-weight: 700;
}

.companion-detail {
  margin: 0;
  max-width: 24ch;
  font-size: 12.5px;
  line-height: 1.42;
  color: color-mix(in oklch, var(--companion-ink) 74%, white);
}

.companion-footer {
  grid-column: 1 / -1;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in oklch, var(--companion-accent) 16%, rgba(255, 255, 255, 0.4));
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 70%, white);
}

.companion-action {
  position: absolute;
  right: 16px;
  bottom: 42px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--companion-accent) 18%, rgba(255, 255, 255, 0.7));
  font-size: 11px;
  letter-spacing: 0.04em;
  color: color-mix(in oklch, var(--companion-ink) 80%, white);
}

.companion-root-reduced .companion-orbit,
.companion-root-reduced .companion-core {
  animation: none;
}

.companion-root-reduced .companion-surface-clickable:hover {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .companion-orbit,
  .companion-core,
  .companion-surface-clickable:hover {
    animation: none;
    transform: none;
  }
}

@keyframes companion-orbit {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes companion-breathe {
  0%,
  100% {
    transform: scale(0.94);
  }
  50% {
    transform: scale(1);
  }
}
</style>
