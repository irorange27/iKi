<template>
  <section
    class="companion-root"
    :class="{ 'companion-root-reduced': reduceMotion }"
    :data-phase="snapshot.phase"
  >
    <div class="companion-drag-strip" aria-hidden="true" />

    <div class="companion-label-bar">
      <span class="companion-label">{{ snapshot.label }}</span>
    </div>

    <div v-if="snapshot.preview" class="companion-preview" :data-preview-kind="snapshot.preview.kind">
      <span class="preview-text" :class="{ 'preview-text-tool': snapshot.preview.kind === 'tool' }">
        <template v-if="snapshot.preview.kind === 'thinking'">{{ previewThinkingLabel }}</template>
        <template v-else-if="snapshot.preview.kind === 'tool'">{{ previewToolLabel }}</template>
        <template v-else>{{ snapshot.preview.text }}</template>
      </span>
    </div>

    <button
      class="companion-stage"
      :class="{ 'companion-stage-clickable': canOpenMainWindow }"
      :aria-label="`${snapshot.label}. ${snapshot.headline}`"
      :type="canOpenMainWindow ? 'button' : undefined"
      @click="handleStageClick"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <img
        v-if="oldSrc"
        class="sprite-layer sprite-old"
        :src="oldSrc"
        :style="{ opacity: oldOpacity }"
        alt=""
        aria-hidden="true"
      />
      <img
        v-if="newSrc"
        class="sprite-layer sprite-new"
        :src="newSrc"
        :style="{ opacity: newOpacity }"
        alt=""
        aria-hidden="true"
      />
    </button>

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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import { createLogger } from '../logger';
import { useConfigStore } from '../store/config';
import { useSpriteTransition } from '../composables/useSpriteTransition';
import {
  PHASE_SPRITE,
  DEFAULT_SPRITE,
  IDLE_VARIANTS,
  DEEP_THINKING_SPRITE,
  HOVER_SPRITE,
  CLICK_SPRITE,
  AFFECT_SAD_SPRITE,
  AFFECT_EXCITED_SPRITE,
  AFFECT_TIRED_SPRITE,
} from '../composables/useCompanionSprites';
import { useCompanionVoice } from '../composables/useCompanionVoice';
import type { CompanionSnapshot } from '../../shared/types/companion';

const companionLogger = createLogger({ module: 'companion_view' });
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const electronAPI = window.electronAPI;

const VIEW_COPY = {
  en: {
    loadingHeadline: 'Waking up',
    loadingDetail: 'Fetching companion state.',
    dismiss: 'Close companion',
  },
  'zh-CN': {
    loadingHeadline: '正在醒来',
    loadingDetail: '同步当前状态。',
    dismiss: '关闭桌宠',
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
const dismissLabel = computed(() => viewCopy.value.dismiss);
const previewThinkingLabel = computed(() => locale.value === 'zh-CN' ? '思考中' : 'Thinking...');
const previewToolLabel = computed(() => {
  const name = snapshot.value.preview?.toolName ?? '';
  return locale.value === 'zh-CN' ? `执行 ${name}` : `Running ${name}`;
});

const { oldSrc, newSrc, oldOpacity, newOpacity, setInitial, setSprite } =
  useSpriteTransition();

const { playPhaseVoice, setMuted } = useCompanionVoice();

const resolveSprite = (phase: string, nudgeKind?: string): string => {
  if (phase === 'nudge') {
    return nudgeKind === 'task-error'
      ? PHASE_SPRITE['nudge-error']
      : PHASE_SPRITE['nudge-success'];
  }
  return PHASE_SPRITE[phase] ?? DEFAULT_SPRITE;
};

// ---- Idle random rotation ----
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const resolveIdleSprite = (): string | null => {
  const affect = snapshot.value.affect;
  if (!affect) {
    const variants = IDLE_VARIANTS.filter(v => v !== oldSrc.value);
    if (variants.length === 0) return IDLE_VARIANTS[0];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  const sadLabels = ['sadness', 'anger', 'fear', 'disgust'];
  const excitedLabels = ['joy', 'surprise'];

  if (sadLabels.includes(affect.label) && affect.valence < 0) {
    return AFFECT_SAD_SPRITE;
  }
  if (excitedLabels.includes(affect.label) && affect.arousal > 0.4) {
    return AFFECT_EXCITED_SPRITE;
  }
  if (affect.arousal < 0.2) {
    return AFFECT_TIRED_SPRITE;
  }

  const variants = IDLE_VARIANTS.filter(v => v !== oldSrc.value);
  if (variants.length === 0) return IDLE_VARIANTS[0];
  return variants[Math.floor(Math.random() * variants.length)];
};

const scheduleIdleRotation = () => {
  if (reduceMotion.value) return;
  const delay = 30_000 + Math.random() * 30_000;
  idleTimer = setTimeout(() => {
    if (snapshot.value.phase !== 'idle' || reactionActive.value) return;
    const pick = resolveIdleSprite();
    if (pick) setSprite(pick);
    scheduleIdleRotation();
  }, delay);
};

const clearIdleRotation = () => {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

// ---- Thinking depth ----
let thinkingCheckTimer: ReturnType<typeof setInterval> | null = null;
let thinkingStartMs = 0;
let toolPreviewCount = 0;

const startThinkingDepthCheck = () => {
  thinkingStartMs = Date.now();
  toolPreviewCount = 0;
  thinkingCheckTimer = setInterval(() => {
    if (snapshot.value.phase !== 'thinking' || reactionActive.value) return;
    const elapsed = (Date.now() - thinkingStartMs) / 1000;
    if (elapsed > 10 || toolPreviewCount > 2) {
      setSprite(DEEP_THINKING_SPRITE);
    }
  }, 1_000);
};

const stopThinkingDepthCheck = () => {
  if (thinkingCheckTimer !== null) {
    clearInterval(thinkingCheckTimer);
    thinkingCheckTimer = null;
  }
  thinkingStartMs = 0;
  toolPreviewCount = 0;
};

// ---- Interaction micro-reactions ----
const reactionActive = ref(false);
let reactionRestoreTimer: ReturnType<typeof setTimeout> | null = null;

const clearReactionRestore = () => {
  if (reactionRestoreTimer !== null) {
    clearTimeout(reactionRestoreTimer);
    reactionRestoreTimer = null;
  }
};

const restorePhaseSprite = () => {
  const src =
    snapshot.value.phase === 'idle'
      ? resolveIdleSprite()
      : resolveSprite(snapshot.value.phase, snapshot.value.nudgeKind);
  if (src) setSprite(src);
};

const handleMouseEnter = () => {
  if (reduceMotion.value) return;
  reactionActive.value = true;
  clearIdleRotation();
  setSprite(HOVER_SPRITE);
};

const handleMouseLeave = () => {
  if (reduceMotion.value) return;
  reactionActive.value = false;
  clearReactionRestore();
  restorePhaseSprite();
  if (snapshot.value.phase === 'idle') scheduleIdleRotation();
};

const handleStageClick = () => {
  if (!reduceMotion.value && snapshot.value.phase !== 'nudge') {
    reactionActive.value = true;
    clearIdleRotation();
    setSprite(CLICK_SPRITE);
    clearReactionRestore();
    reactionRestoreTimer = setTimeout(() => {
      reactionActive.value = false;
      restorePhaseSprite();
      if (snapshot.value.phase === 'idle') scheduleIdleRotation();
    }, 400);
  }
  void handleOpenMainWindow();
};

// ---- Phase watcher ----
watch(
  () => snapshot.value.phase,
  (phase) => {
    clearReactionRestore();
    reactionActive.value = false;
    stopThinkingDepthCheck();
    clearIdleRotation();

    const src =
      phase === 'idle' ? resolveIdleSprite() : resolveSprite(phase, snapshot.value.nudgeKind);
    if (src) setSprite(src);
    if (!reduceMotion.value) playPhaseVoice(phase, snapshot.value.nudgeKind);

    if (phase === 'idle') scheduleIdleRotation();
    if (phase === 'thinking') startThinkingDepthCheck();
  }
);

// Track tool previews for thinking depth
watch(
  () => snapshot.value.preview?.kind,
  (kind) => {
    if (kind === 'tool' && snapshot.value.phase === 'thinking') {
      toolPreviewCount += 1;
    }
  }
);

watch(
  () => snapshot.value.nudgeKind,
  (kind) => {
    if (snapshot.value.phase === 'nudge') {
      const src = resolveSprite('nudge', kind);
      if (src) setSprite(src);
      if (!reduceMotion.value) playPhaseVoice('nudge', kind);
    }
  }
);

watch(reduceMotion, (val) => setMuted(val), { immediate: true });

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
    const initial = await electronAPI?.companion?.getSnapshot?.();
    if (initial) {
      snapshot.value = initial;
      const src = resolveSprite(initial.phase, initial.nudgeKind);
      if (src) setInitial(src);
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
    electronAPI?.companion?.onUpdated?.((next: CompanionSnapshot) => {
      snapshot.value = next;
    }) ?? (() => undefined);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
  removeCompanionListener();
  clearIdleRotation();
  stopThinkingDepthCheck();
  clearReactionRestore();
});
</script>

<style scoped>
.companion-root {
  --companion-accent: oklch(0.76 0.018 150);
  --companion-ink: color-mix(in oklch, var(--companion-accent) 12%, oklch(0.34 0.015 72));
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: 12px auto auto 1fr;
  box-sizing: border-box;
}

.companion-root[data-phase='dormant'] {
  --companion-accent: oklch(0.73 0.018 250);
}

.companion-root[data-phase='idle'] {
  --companion-accent: oklch(0.73 0.015 180);
}

.companion-root[data-phase='thinking'] {
  --companion-accent: oklch(0.78 0.024 226);
}

.companion-root[data-phase='clarify'] {
  --companion-accent: oklch(0.82 0.028 88);
}

.companion-root[data-phase='co_plan'] {
  --companion-accent: oklch(0.8 0.024 164);
}

.companion-root[data-phase='stabilize'] {
  --companion-accent: oklch(0.8 0.02 58);
}

.companion-root[data-phase='execute'] {
  --companion-accent: oklch(0.79 0.03 142);
}

.companion-root[data-phase='nudge'] {
  --companion-accent: oklch(0.83 0.035 76);
}

.companion-drag-strip {
  height: 12px;
  -webkit-app-region: drag;
}

.companion-stage {
  grid-row: 4;
  position: relative;
  display: grid;
  place-items: end center;
  width: 100%;
  min-height: 0;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: default;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.companion-stage-clickable {
  cursor: pointer;
}

.companion-stage-clickable:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 32%, white);
  outline-offset: -2px;
}

.sprite-layer {
  grid-area: 1 / 1;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  object-position: center bottom;
  transition: opacity 300ms ease;
  user-select: none;
  pointer-events: none;
}

.companion-root-reduced .sprite-layer {
  transition: none;
}

.companion-label-bar {
  display: flex;
  justify-content: center;
  padding: 4px 8px 6px;
  -webkit-app-region: no-drag;
}

.companion-label {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in oklch, var(--companion-ink) 78%, transparent);
}

.companion-preview {
  margin: 2px 4px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--companion-accent) 18%, oklch(0.18 0.01 260 / 0.62));
  border: 1px solid color-mix(in oklch, var(--companion-accent) 22%, oklch(0.5 0.02 260 / 0.18));
  -webkit-app-region: no-drag;
  max-height: 4.2em;
  overflow: hidden;
}

.preview-text {
  display: block;
  font-size: 11.5px;
  line-height: 1.4;
  color: color-mix(in oklch, var(--companion-accent) 42%, oklch(0.92 0.006 100));
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  word-break: break-word;
}

.preview-text-tool {
  -webkit-line-clamp: 2;
}

@media (prefers-color-scheme: dark) {
  .companion-preview {
    background: color-mix(in oklch, var(--companion-accent) 22%, oklch(0.25 0.01 260 / 0.68));
    border-color: color-mix(in oklch, var(--companion-accent) 28%, oklch(0.55 0.02 260 / 0.22));
  }

  .companion-label {
    color: color-mix(in oklch, var(--companion-accent) 58%, oklch(0.88 0.006 100));
  }
}

.companion-dismiss {
  position: absolute;
  top: 2px;
  right: 4px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: color-mix(in oklch, var(--companion-ink) 38%, transparent);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 160ms ease;
  -webkit-app-region: no-drag;
}

.companion-root:hover .companion-dismiss,
.companion-dismiss:focus-visible {
  opacity: 1;
}

.companion-dismiss:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--companion-accent) 28%, white);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .sprite-layer {
    transition: none;
  }
}
</style>
