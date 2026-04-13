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
        <span class="companion-stem" />
        <div class="companion-body">
          <span class="companion-aura" />
          <span class="companion-fin companion-fin-left" />
          <span class="companion-fin companion-fin-top" />
          <span class="companion-orbit" />
          <span class="companion-orbit companion-orbit-secondary" />
          <span class="companion-core" />
          <span class="companion-pupil" />
          <span class="companion-lattice" />
        </div>
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
  --companion-accent: oklch(0.7 0.11 220);
  --companion-ink: color-mix(in oklch, var(--companion-accent) 18%, oklch(0.2 0.01 248));
  --companion-shell: color-mix(in oklch, var(--companion-accent) 12%, rgba(255, 255, 255, 0.9));
  --companion-edge: color-mix(in oklch, var(--companion-accent) 22%, rgba(255, 255, 255, 0.44));
  --orbit-speed: 7.6s;
  --body-tilt: -5deg;
  --body-rise: 0px;
  --body-radius: 42px 30px 44px 26px / 38px 36px 42px 30px;
  --pupil-x: -4px;
  --pupil-y: 1px;
  --aura-opacity: 0.78;
  --fin-left-scale: 1;
  --fin-top-scale: 1;
  --caption-shift: 0px;
  position: relative;
  width: 100%;
  height: 100%;
  padding: 8px 9px 12px;
  box-sizing: border-box;
}

.companion-root[data-phase='dormant'] {
  --companion-accent: oklch(0.62 0.03 245);
  --orbit-speed: 10.8s;
  --body-tilt: -1deg;
  --pupil-x: 0px;
  --pupil-y: 0px;
  --aura-opacity: 0.44;
  --fin-left-scale: 0.88;
  --fin-top-scale: 0.82;
}

.companion-root[data-phase='idle'] {
  --body-tilt: -6deg;
  --pupil-x: -3px;
  --pupil-y: 1px;
}

.companion-root[data-phase='thinking'] {
  --companion-accent: oklch(0.71 0.12 225);
  --orbit-speed: 4.2s;
  --body-tilt: 10deg;
  --body-rise: -2px;
  --pupil-x: 11px;
  --pupil-y: -5px;
  --fin-top-scale: 1.18;
}

.companion-root[data-phase='clarify'] {
  --companion-accent: oklch(0.77 0.12 95);
  --orbit-speed: 6.3s;
  --body-tilt: -13deg;
  --pupil-x: -12px;
  --pupil-y: -3px;
  --fin-left-scale: 1.12;
}

.companion-root[data-phase='co_plan'] {
  --companion-accent: oklch(0.76 0.11 170);
  --orbit-speed: 5.7s;
  --body-tilt: 7deg;
  --body-rise: -2px;
  --pupil-x: 8px;
  --pupil-y: -2px;
  --fin-left-scale: 1.16;
  --fin-top-scale: 1.08;
}

.companion-root[data-phase='stabilize'] {
  --companion-accent: oklch(0.7 0.11 26);
  --orbit-speed: 9.4s;
  --body-tilt: 0deg;
  --body-radius: 38px 34px 38px 34px / 34px 34px 40px 40px;
  --pupil-x: 0px;
  --pupil-y: 2px;
  --aura-opacity: 0.54;
  --fin-left-scale: 0.82;
  --fin-top-scale: 0.78;
}

.companion-root[data-phase='execute'] {
  --companion-accent: oklch(0.72 0.14 150);
  --orbit-speed: 4.8s;
  --body-tilt: 14deg;
  --body-rise: -4px;
  --pupil-x: 12px;
  --pupil-y: -2px;
}

.companion-root[data-phase='nudge'] {
  --companion-accent: oklch(0.8 0.12 85);
  --orbit-speed: 3.8s;
  --body-tilt: -15deg;
  --body-rise: -3px;
  --pupil-x: -10px;
  --pupil-y: -4px;
  --aura-opacity: 0.96;
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
  background: color-mix(in oklch, var(--companion-accent) 15%, transparent);
}

.companion-shell {
  position: relative;
  display: block;
  width: 100%;
  min-height: calc(100% - 12px);
  background: transparent;
  border: 0;
  box-shadow: none;
  color: var(--companion-ink);
  text-align: left;
  box-sizing: border-box;
  overflow: visible;
  -webkit-app-region: no-drag;
}

.companion-shell::before {
  content: '';
  position: absolute;
  left: 10px;
  right: 18px;
  bottom: 8px;
  height: 22px;
  border-radius: 999px;
  background: radial-gradient(
    ellipse at center,
    color-mix(in oklch, var(--companion-accent) 18%, rgba(9, 15, 26, 0.16)),
    transparent 72%
  );
  filter: blur(8px);
  pointer-events: none;
}

.companion-shell-clickable {
  cursor: pointer;
}

.companion-shell-clickable:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 48%, white);
  outline-offset: 3px;
}

.companion-dismiss {
  position: absolute;
  top: 16px;
  right: 8px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid color-mix(in oklch, var(--companion-accent) 18%, rgba(255, 255, 255, 0.54));
  border-radius: 999px;
  background: color-mix(in oklch, var(--companion-shell) 92%, rgba(255, 255, 255, 0.9));
  box-shadow:
    0 8px 16px rgba(9, 15, 26, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  color: color-mix(in oklch, var(--companion-ink) 74%, white);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.88;
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;
  -webkit-app-region: no-drag;
}

.companion-dismiss:hover,
.companion-dismiss:focus-visible {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow:
    0 10px 20px rgba(9, 15, 26, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.companion-dismiss:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 40%, white);
  outline-offset: 2px;
}

.companion-body-wrap {
  position: absolute;
  top: 0;
  right: 4px;
  width: 118px;
  height: 116px;
  z-index: 2;
  transform: translateY(var(--body-rise));
  transition: transform 260ms ease;
}

.companion-stem {
  position: absolute;
  left: 30px;
  bottom: -6px;
  width: 44px;
  height: 48px;
  border-radius: 18px 18px 24px 24px;
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--companion-accent) 30%, rgba(255, 255, 255, 0.58)),
    color-mix(in oklch, var(--companion-accent) 12%, rgba(255, 255, 255, 0.12))
  );
  border: 1px solid color-mix(in oklch, var(--companion-accent) 16%, rgba(255, 255, 255, 0.22));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48);
  opacity: 0.86;
}

.companion-body {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: var(--body-radius);
  transform: rotate(var(--body-tilt));
  background:
    radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.78), transparent 34%),
    linear-gradient(
      165deg,
      color-mix(in oklch, var(--companion-accent) 20%, white),
      color-mix(in oklch, var(--companion-accent) 56%, rgba(16, 22, 34, 0.06))
    );
  box-shadow:
    0 20px 34px rgba(9, 15, 26, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.82),
    inset 0 -18px 28px color-mix(in oklch, var(--companion-accent) 14%, transparent);
  transition:
    transform 260ms ease,
    box-shadow 260ms ease,
    border-radius 260ms ease;
}

.companion-aura {
  position: absolute;
  inset: -14px;
  border-radius: 48px;
  background: radial-gradient(
    circle at center,
    color-mix(in oklch, var(--companion-accent) 28%, transparent),
    transparent 68%
  );
  filter: blur(10px);
  opacity: var(--aura-opacity);
}

.companion-fin,
.companion-orbit,
.companion-core,
.companion-lattice,
.companion-pupil {
  position: absolute;
  pointer-events: none;
}

.companion-fin {
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.74),
    color-mix(in oklch, var(--companion-accent) 18%, rgba(255, 255, 255, 0.34))
  );
  border: 1px solid color-mix(in oklch, var(--companion-accent) 20%, rgba(255, 255, 255, 0.4));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
}

.companion-fin-left {
  left: -8px;
  top: 40px;
  width: 25px;
  height: 23px;
  border-radius: 18px 11px 11px 18px;
  transform: rotate(-22deg) scale(var(--fin-left-scale));
}

.companion-fin-top {
  top: -7px;
  right: 30px;
  width: 30px;
  height: 15px;
  border-radius: 10px 18px 10px 16px;
  transform: rotate(14deg) scale(var(--fin-top-scale));
}

.companion-orbit {
  inset: 11px;
  border-radius: 32px 24px 34px 22px / 28px 30px 36px 24px;
  border: 1px solid color-mix(in oklch, var(--companion-accent) 34%, rgba(255, 255, 255, 0.66));
  animation: companion-orbit var(--orbit-speed) linear infinite;
}

.companion-orbit-secondary {
  inset: 23px;
  border-radius: 22px 18px 24px 16px / 18px 22px 28px 18px;
  opacity: 0.62;
  animation-direction: reverse;
}

.companion-core {
  inset: 31px;
  border-radius: 26px 18px 24px 18px / 22px 18px 24px 20px;
  background:
    radial-gradient(circle at 38% 34%, rgba(255, 255, 255, 0.98), transparent 33%),
    radial-gradient(
      circle at center,
      color-mix(in oklch, var(--companion-accent) 34%, white),
      color-mix(in oklch, var(--companion-accent) 74%, rgba(16, 21, 32, 0.05))
    );
  box-shadow: 0 0 24px color-mix(in oklch, var(--companion-accent) 24%, transparent);
  animation: companion-breathe 3.3s ease-in-out infinite;
}

.companion-pupil {
  top: calc(46px + var(--pupil-y));
  left: calc(54px + var(--pupil-x));
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow:
    0 0 0 6px color-mix(in oklch, var(--companion-accent) 18%, transparent),
    0 0 18px rgba(255, 255, 255, 0.48);
  transition:
    left 260ms ease,
    top 260ms ease;
}

.companion-lattice {
  inset: 0;
  border-radius: inherit;
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
  opacity: 0.54;
}

.companion-caption {
  position: absolute;
  left: 0;
  right: 6px;
  bottom: 0;
  z-index: 1;
  display: grid;
  gap: 4px;
  min-height: 76px;
  padding: 16px 14px 13px;
  border: 1px solid var(--companion-edge);
  border-radius: 28px 24px 24px 26px / 22px 24px 20px 24px;
  background: linear-gradient(
    150deg,
    color-mix(in oklch, var(--companion-shell) 88%, rgba(255, 255, 255, 0.92)),
    color-mix(in oklch, var(--companion-accent) 8%, rgba(11, 17, 28, 0.05))
  );
  box-shadow:
    0 16px 28px rgba(10, 16, 28, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.64);
  transform: translateY(var(--caption-shift));
  transition:
    transform 260ms ease,
    box-shadow 260ms ease;
}

.companion-caption::before {
  content: '';
  position: absolute;
  right: 58px;
  top: -10px;
  width: 40px;
  height: 18px;
  border-radius: 14px 14px 10px 10px;
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--companion-shell) 94%, rgba(255, 255, 255, 0.94)),
    color-mix(in oklch, var(--companion-accent) 10%, rgba(11, 17, 28, 0.04))
  );
  border: 1px solid var(--companion-edge);
  border-bottom: 0;
}

.companion-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.companion-label {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 72%, white);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.companion-updated {
  flex-shrink: 0;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 56%, white);
}

.companion-headline {
  margin: 0;
  max-width: 11ch;
  font-size: 24px;
  line-height: 0.96;
  font-weight: 700;
  letter-spacing: -0.035em;
}

.companion-detail {
  margin: 0;
  max-width: 14ch;
  max-height: 1.35em;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.35;
  color: color-mix(in oklch, var(--companion-ink) 70%, white);
  opacity: 0.8;
  transform: translateY(1px);
  transition:
    max-height 240ms ease,
    opacity 240ms ease,
    transform 240ms ease;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.companion-action {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--companion-accent) 16%, rgba(255, 255, 255, 0.8));
  border: 1px solid color-mix(in oklch, var(--companion-accent) 24%, rgba(255, 255, 255, 0.55));
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 74%, white);
  opacity: 0;
  transform: translateY(7px);
  transition:
    opacity 220ms ease,
    transform 220ms ease;
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
  transform: translateY(calc(var(--body-rise) - 4px));
}

.companion-shell-clickable:hover .companion-body,
.companion-shell-clickable:focus-visible .companion-body {
  box-shadow:
    0 24px 38px rgba(9, 15, 26, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.86),
    inset 0 -20px 32px color-mix(in oklch, var(--companion-accent) 16%, transparent);
}

.companion-shell-clickable:hover .companion-caption,
.companion-shell-clickable:focus-visible .companion-caption {
  transform: translateY(-2px);
  box-shadow:
    0 20px 30px rgba(10, 16, 28, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.companion-shell-clickable:hover .companion-detail,
.companion-shell-clickable:focus-visible .companion-detail {
  max-height: 3.1em;
  opacity: 1;
  transform: translateY(0);
  -webkit-line-clamp: 2;
}

.companion-shell-clickable:hover .companion-action,
.companion-shell-clickable:focus-visible .companion-action {
  opacity: 1;
  transform: translateY(0);
}

.companion-root-reduced .companion-orbit,
.companion-root-reduced .companion-core {
  animation: none;
}

.companion-root-reduced .companion-body-wrap,
.companion-root-reduced .companion-body,
.companion-root-reduced .companion-caption,
.companion-root-reduced .companion-detail,
.companion-root-reduced .companion-action,
.companion-root-reduced .companion-pupil,
.companion-root-reduced .companion-dismiss {
  transition: none;
}

.companion-root-reduced .companion-shell-clickable:hover .companion-body-wrap,
.companion-root-reduced .companion-shell-clickable:hover .companion-caption,
.companion-root-reduced .companion-shell-clickable:hover .companion-detail,
.companion-root-reduced .companion-shell-clickable:hover .companion-action {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .companion-orbit,
  .companion-core {
    animation: none;
  }

  .companion-body-wrap,
  .companion-body,
  .companion-caption,
  .companion-detail,
  .companion-action,
  .companion-pupil,
  .companion-dismiss {
    transition: none;
  }

  .companion-shell-clickable:hover .companion-body-wrap,
  .companion-shell-clickable:hover .companion-caption,
  .companion-shell-clickable:hover .companion-detail,
  .companion-shell-clickable:hover .companion-action {
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
    transform: scale(0.95);
  }

  50% {
    transform: scale(1);
  }
}
</style>
