<template>
  <!-- Renderer-drawn macOS traffic lights: the native buttons grey out to
       near-invisible on the light sidebar when the window loses focus, so we
       own them. Focused = standard colors; unfocused = mid-gray (visible on
       the light background, unlike macOS 15's native unfocused tint). Glyphs
       on group hover, hidden in fullscreen (matching the native lights).
       Position mirrors the old trafficLightPosition (20, 20). -->
  <div
    v-if="visible && !isFullscreen"
    class="traffic-lights"
    :class="{ 'traffic-lights-inactive': !isWindowFocused }"
  >
    <button
      class="traffic-light traffic-light-close"
      type="button"
      :aria-label="t('common.close')"
      @click="closeWindow?.()"
    >
      <svg class="traffic-light-glyph" viewBox="0 0 12 12">
        <path d="M4 4l4 4M8 4l-4 4" />
      </svg>
    </button>
    <button
      class="traffic-light traffic-light-minimize"
      type="button"
      :aria-label="t('common.minimize')"
      @click="controls?.minimize()"
    >
      <svg class="traffic-light-glyph" viewBox="0 0 12 12">
        <path d="M2.8 6h6.4" />
      </svg>
    </button>
    <button
      class="traffic-light traffic-light-zoom"
      type="button"
      :aria-label="t('common.zoom')"
      @click="controls?.toggleMaximize()"
    >
      <svg class="traffic-light-glyph" viewBox="0 0 12 12">
        <path d="M3.2 6.8V3.2h3.6M8.8 5.2v3.6H5.2" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

import { getElectronApiMethod, getElectronApiSlice } from '../services/electron_api';
import { useI18n } from '../i18n';

const { t } = useI18n();

// The slice only exists on darwin (preload), so this renders nothing elsewhere.
const controls = getElectronApiSlice('windowControls');
const closeWindow = getElectronApiMethod('closeWindow');
const isFullscreen = ref(false);
const isWindowFocused = ref(true);
let unsubscribeFullscreen: (() => void) | null = null;
let unsubscribeFocus: (() => void) | null = null;

if (controls) {
  unsubscribeFullscreen = controls.onFullscreenChange(fullscreen => {
    isFullscreen.value = fullscreen;
  });
  unsubscribeFocus = controls.onFocusChange(focused => {
    isWindowFocused.value = focused;
  });
}

const visible = ref(Boolean(controls));

onBeforeUnmount(() => {
  unsubscribeFullscreen?.();
  unsubscribeFocus?.();
  unsubscribeFullscreen = null;
  unsubscribeFocus = null;
});
</script>

<style scoped>
.traffic-lights {
  position: fixed;
  left: 20px;
  top: 20px;
  z-index: var(--z-chrome);
  display: flex;
  gap: 8px;
}

.traffic-light {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  padding: 0;
  border-radius: 50%;
  border: 0.5px solid transparent;
  cursor: pointer;
}

.traffic-light-glyph {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: rgba(0, 0, 0, 0.55);
  stroke-width: 1.2;
  stroke-linecap: round;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.traffic-lights:hover .traffic-light-glyph {
  opacity: 1;
}

.traffic-light-close {
  background: #ff5f57;
  border-color: #e0443e;
}

.traffic-light-minimize {
  background: #febc2e;
  border-color: #dea123;
}

.traffic-light-zoom {
  background: #28c840;
  border-color: #1aab29;
}

/* Unfocused: macOS convention mutes the lights, but the native tint is
   invisible on the light sidebar — use a mid-gray that still reads. */
.traffic-lights-inactive .traffic-light {
  background: #c2c4c8;
  border-color: #aeb1b6;
}
</style>
