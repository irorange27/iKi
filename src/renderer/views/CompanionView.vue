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
      class="companion-shell"
      :class="{ 'companion-shell-clickable': canOpenMainWindow }"
      :type="surfaceTag === 'button' ? 'button' : undefined"
      :aria-label="`${snapshot.label}. ${snapshot.headline}. ${snapshot.detail}`"
      @click="handleOpenMainWindow"
    >
      <div class="companion-body-wrap" aria-hidden="true">
        <span class="companion-base" />
        <div class="companion-body" />
      </div>

      <div class="companion-caption">
        <div class="companion-meta">
          <p class="companion-label">{{ snapshot.label }}</p>
          <span class="companion-updated">{{ updatedLabel }}</span>
        </div>
        <h1 class="companion-headline">{{ snapshot.headline }}</h1>
        <p class="companion-detail">{{ snapshot.detail }}</p>
      </div>

      <span v-if="canOpenMainWindow" class="companion-action">
        {{ actionLabel }}
        <span class="companion-action-sep" aria-hidden="true" />
        {{ phaseMeta }}
      </span>
    </component>

    <button
      type="button"
      class="companion-dismiss"
      :aria-label="dismissLabel"
      :title="dismissLabel"
      @click.stop="handleDismissCompanion"
    >
      <span aria-hidden="true">×</span>
    </button>
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
    loadingHeadline: 'Waking up',
    loadingDetail: 'Fetching companion state.',
    action: 'Open chat',
    dismiss: 'Close companion',
    phaseMeta: {
      dormant: 'Offline',
      idle: 'Here',
      thinking: 'Reading',
      clarify: 'Ask',
      co_plan: 'Plan',
      stabilize: 'Steady',
      execute: 'Move',
      nudge: 'Chime',
    },
  },
  'zh-CN': {
    loadingHeadline: '正在醒来',
    loadingDetail: '同步当前 companion 状态。',
    action: '打开聊天',
    dismiss: '关闭桌宠',
    phaseMeta: {
      dormant: '离线',
      idle: '在场',
      thinking: '读取',
      clarify: '提问',
      co_plan: '共拟',
      stabilize: '稳住',
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
const dismissLabel = computed(() => viewCopy.value.dismiss);
const updatedLabel = computed(() => {
  const updatedAt = new Date(snapshot.value.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return '';

  const formatterLocale = config.value.general.language === 'zh-CN' ? 'zh-CN' : 'en';
  return new Intl.DateTimeFormat(formatterLocale, {
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

const handleDismissCompanion = async () => {
  try {
    if (electronAPI?.companion?.disable) {
      await electronAPI.companion.disable();
      return;
    }
  } catch (error) {
    companionLogger.event({
      level: 'warn',
      event: 'companion.disable',
      outcome: 'failed',
      error,
      message: 'Failed to disable companion view from companion window.',
    });
  }

  electronAPI?.closeWindow?.();
};

const handleWindowKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  void handleDismissCompanion();
};

let removeCompanionListener: () => void = () => undefined;

onMounted(async () => {
  window.addEventListener('keydown', handleWindowKeydown);
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
  window.removeEventListener('keydown', handleWindowKeydown);
  removeCompanionListener();
});
</script>

<style scoped>
.companion-root {
  --companion-accent: oklch(0.76 0.018 150);
  --companion-ink: color-mix(in oklch, var(--companion-accent) 12%, oklch(0.34 0.015 72));
  --companion-shell: color-mix(in oklch, var(--companion-accent) 2.5%, oklch(0.985 0.006 96));
  --companion-edge: color-mix(in oklch, var(--companion-accent) 7%, rgba(128, 109, 90, 0.18));
  --body-rise: 0px;
  --body-scale: 1;
  position: relative;
  width: 100%;
  height: 100%;
  padding: 8px 9px 12px;
  box-sizing: border-box;
}

.companion-root[data-phase='dormant'] {
  --companion-accent: oklch(0.73 0.018 250);
  --body-scale: 0.99;
}

.companion-root[data-phase='idle'] {
}

.companion-root[data-phase='thinking'] {
  --companion-accent: oklch(0.78 0.024 226);
  --body-rise: -1px;
  --body-scale: 1.01;
}

.companion-root[data-phase='clarify'] {
  --companion-accent: oklch(0.82 0.028 88);
}

.companion-root[data-phase='co_plan'] {
  --companion-accent: oklch(0.8 0.024 164);
  --body-rise: -1px;
  --body-scale: 1.005;
}

.companion-root[data-phase='stabilize'] {
  --companion-accent: oklch(0.8 0.02 58);
}

.companion-root[data-phase='execute'] {
  --companion-accent: oklch(0.79 0.03 142);
  --body-rise: -1px;
}

.companion-root[data-phase='nudge'] {
  --companion-accent: oklch(0.83 0.035 76);
  --body-rise: -1px;
  --body-scale: 1.01;
}

.companion-drag-strip {
  height: 12px;
  display: grid;
  place-items: center;
  -webkit-app-region: drag;
}

.companion-drag-notch {
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--companion-accent) 8%, rgba(79, 56, 35, 0.12));
}

.companion-shell {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  grid-template-areas:
    'body caption'
    'body action';
  align-items: end;
  align-content: end;
  column-gap: 8px;
  row-gap: 4px;
  width: 100%;
  min-height: calc(100% - 12px);
  padding: 18px 8px 12px;
  background: transparent;
  border: 0;
  box-shadow: none;
  color: var(--companion-ink);
  text-align: left;
  box-sizing: border-box;
  overflow: visible;
  -webkit-app-region: no-drag;
}

.companion-shell-clickable {
  cursor: pointer;
}

.companion-shell-clickable:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 32%, white);
  outline-offset: 3px;
}

.companion-dismiss {
  position: absolute;
  top: 18px;
  right: 12px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid color-mix(in oklch, var(--companion-accent) 10%, rgba(109, 85, 61, 0.16));
  border-radius: 999px;
  background: color-mix(in oklch, var(--companion-shell) 97%, rgba(255, 255, 255, 0.98));
  box-shadow:
    0 3px 8px rgba(68, 49, 31, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.84);
  color: color-mix(in oklch, var(--companion-ink) 82%, white);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.56;
  transition:
    opacity 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
  -webkit-app-region: no-drag;
}

.companion-dismiss:hover,
.companion-dismiss:focus-visible {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow:
    0 6px 12px rgba(68, 49, 31, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.88);
}

.companion-dismiss:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 28%, white);
  outline-offset: 2px;
}

.companion-body-wrap {
  grid-area: body;
  position: relative;
  width: 18px;
  height: 18px;
  z-index: 2;
  align-self: end;
  justify-self: end;
  margin-bottom: 6px;
  transform: translateY(var(--body-rise));
  transition: transform 180ms ease;
}

.companion-base {
  display: none;
}

.companion-body {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 1px solid color-mix(in oklch, var(--companion-accent) 10%, rgba(108, 83, 61, 0.16));
  background: color-mix(in oklch, var(--companion-shell) 96%, rgba(248, 245, 239, 0.95));
  box-shadow:
    0 4px 8px rgba(62, 46, 30, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.75);
  transform: scale(calc(var(--body-scale) * 0.98));
  animation: none;
  transition:
    transform 180ms ease,
    box-shadow 220ms ease,
    border-color 220ms ease;
}

.companion-body::before {
  display: none;
}

.companion-caption {
  grid-area: caption;
  position: relative;
  z-index: 1;
  display: grid;
  align-self: end;
  gap: 1px;
  width: 100%;
  min-height: 38px;
  padding: 7px 10px 6px;
  border: 1px solid color-mix(in oklch, var(--companion-edge) 70%, rgba(255, 255, 255, 0.18));
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--companion-shell) 98%, rgba(248, 245, 239, 0.9)),
    color-mix(in oklch, var(--companion-accent) 1.2%, rgba(241, 236, 229, 0.86))
  );
  box-shadow:
    0 2px 4px rgba(64, 46, 30, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}

.companion-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.companion-label {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  font-size: 6.6px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 68%, rgba(255, 255, 255, 0.8));
  white-space: nowrap;
  text-overflow: ellipsis;
}

.companion-updated {
  flex-shrink: 0;
  font-size: 6.4px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 48%, rgba(255, 255, 255, 0.72));
}

.companion-headline {
  margin: 0;
  max-width: 7ch;
  font-size: 13px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.companion-detail {
  margin: 0;
  max-width: 14ch;
  max-height: 0;
  overflow: hidden;
  font-size: 8.2px;
  line-height: 1.35;
  color: color-mix(in oklch, var(--companion-ink) 62%, rgba(255, 255, 255, 0.74));
  opacity: 0;
  transition:
    max-height 220ms ease,
    opacity 220ms ease;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.companion-action {
  grid-area: action;
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 9px;
  padding: 0 0 0 9px;
  font-size: 6.4px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 62%, rgba(255, 255, 255, 0.74));
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.companion-action-sep {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.5;
}

.companion-shell-clickable:hover .companion-body-wrap,
.companion-shell-clickable:focus-visible .companion-body-wrap {
  transform: translateY(calc(var(--body-rise) - 1px));
}

.companion-shell-clickable:hover .companion-body,
.companion-shell-clickable:focus-visible .companion-body {
  box-shadow:
    0 10px 16px rgba(62, 46, 30, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.84),
    inset 0 -7px 12px color-mix(in oklch, var(--companion-accent) 11%, rgba(83, 61, 41, 0.04));
}

.companion-shell-clickable:hover .companion-caption,
.companion-shell-clickable:focus-visible .companion-caption {
  transform: translateX(-1px);
  box-shadow:
    0 6px 12px rgba(64, 46, 30, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.companion-shell-clickable:hover .companion-detail,
.companion-shell-clickable:focus-visible .companion-detail {
  max-height: 3.1em;
  opacity: 1;
  -webkit-line-clamp: 2;
}

.companion-shell-clickable:hover .companion-action,
.companion-shell-clickable:focus-visible .companion-action {
  opacity: 1;
  transform: translateY(0);
}

.companion-root-reduced .companion-body-wrap,
.companion-root-reduced .companion-body,
.companion-root-reduced .companion-caption,
.companion-root-reduced .companion-detail,
.companion-root-reduced .companion-action,
.companion-root-reduced .companion-dismiss {
  transition: none;
}

.companion-root-reduced .companion-shell-clickable:hover .companion-body-wrap,
.companion-root-reduced .companion-shell-clickable:hover .companion-caption,
.companion-root-reduced .companion-shell-clickable:hover .companion-action {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .companion-body {
    animation: none;
  }

  .companion-body-wrap,
  .companion-body,
  .companion-caption,
  .companion-detail,
  .companion-action,
  .companion-dismiss {
    transition: none;
  }

  .companion-shell-clickable:hover .companion-body-wrap,
  .companion-shell-clickable:hover .companion-caption,
  .companion-shell-clickable:hover .companion-action {
    transform: none;
  }
}

@keyframes companion-breathe {
  0%,
  100% {
    transform: scale(calc(var(--body-scale) - 0.006));
  }

  50% {
    transform: scale(calc(var(--body-scale) + 0.006));
  }
}
</style>
