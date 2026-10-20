<template>
  <div class="app-container" :data-shell="shellKind">
    <!-- First Tab stops: skip the sidebar and land on the conversation or the
         composer. Visually hidden until focused, then pinned to the top-left. -->
    <div v-if="!isCompanion" class="skip-links">
      <a
        class="skip-link"
        href="#chat-conversation"
        @click.prevent="focusLandmark('chat-conversation')"
      >
        {{ t('a11y.skipToConversation') }}
      </a>
      <a
        class="skip-link"
        href="#chat-input-field"
        @click.prevent="focusLandmark('chat-input-field')"
      >
        {{ t('a11y.skipToComposer') }}
      </a>
    </div>
    <div v-if="!isCompanion" class="titlebar-drag-region"></div>
    <TrafficLights v-if="!isCompanion" />
    <CompanionView v-if="isCompanion" />
    <SettingsView
      v-else-if="isSettings"
      :initial-section="settingsSection"
      @close="closeSettings"
    />
    <ChatView v-else />
    <ConfirmDialog />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import SettingsView from './views/SettingsView.vue';
import ChatView from './views/ChatView.vue';
import TrafficLights from './components/TrafficLights.vue';
import CompanionView from './views/CompanionView.vue';
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import { useAppConfig } from './composables/useAppConfig';
import { useAppLocale } from './composables/useAppLocale';
import { useI18n } from './i18n';
import { createSidebar } from './composables/useSidebar';
import { useTheme } from './composables/useTheme';

createSidebar();
useTheme();
useAppLocale();
const { t } = useI18n();
const electronAPI = window.electronAPI;

// Skip links move focus programmatically: a fragment href alone updates the URL
// but leaves focus where it was, so the target is focused explicitly.
const focusLandmark = (id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus();
  target.scrollIntoView({ block: 'nearest' });
};
const currentHash = ref(window.location.hash);
const updateHash = () => {
  currentHash.value = window.location.hash;
};

const extractSettingsSection = (hash: string): string | undefined => {
  const normalized = hash.replace(/^#/, '').trim();
  if (!normalized.startsWith('settings/')) return undefined;

  const [, section] = normalized.split('/', 2);
  return typeof section === 'string' && section.trim().length > 0 ? section.trim() : undefined;
};

onMounted(() => {
  window.addEventListener('hashchange', updateHash);
});

onUnmounted(() => {
  window.removeEventListener('hashchange', updateHash);
  unsubscribeFocusThread?.();
  unsubscribeFocusThread = null;
  document.documentElement.classList.remove('companion-shell-mode');
  document.body.classList.remove('companion-shell-mode');
});

const isCompanion = computed(() => currentHash.value.includes('companion'));
const isSettings = computed(() => currentHash.value.includes('settings'));
const settingsSection = computed(() => extractSettingsSection(currentHash.value));
const shellKind = computed(() =>
  isCompanion.value ? 'companion' : isSettings.value ? 'settings' : 'main'
);
// Settings now live in the main window (hash `#settings`); closing returns to
// the chat view instead of closing a dedicated window.
const closeSettings = () => {
  window.location.hash = '';
};

// A task-review "focus thread" jump should land on the chat view, not behind
// the settings page. Re-subscribed per settings visit; cleaned up on leave.
let unsubscribeFocusThread: (() => void) | null = null;
watch(isSettings, enabled => {
  unsubscribeFocusThread?.();
  unsubscribeFocusThread = null;
  if (!enabled) return;
  unsubscribeFocusThread =
    electronAPI?.onFocusThread?.(() => {
      window.location.hash = '';
    }) ?? null;
});

watch(
  isCompanion,
  enabled => {
    document.documentElement.classList.toggle('companion-shell-mode', enabled);
    document.body.classList.toggle('companion-shell-mode', enabled);
  },
  { immediate: true }
);

useAppConfig();
</script>

<style>
html,
body,
#app,
.app-container {
  margin: 0;
  width: 100%;
  height: 100%;
}

body {
  overflow: hidden;
}

html,
body,
#app,
.app-container {
  background-color: var(--bg-primary);
}

html.companion-shell-mode,
body.companion-shell-mode,
html.companion-shell-mode #app,
html.companion-shell-mode .app-container {
  background-color: transparent;
}

#app,
.app-container {
  /* Keep renderer content clipped to native window corners to avoid halo edges. */
  overflow: hidden;
}

.app-container {
  /* Frameless light windows need an explicit shell edge to stay legible over other apps. */
  box-sizing: border-box;
  border: 1px solid var(--app-shell-border-color);
  box-shadow: var(--app-shell-shadow);
}

/* Skip links are the first thing a keyboard user reaches. Each stays clipped to
   a 1px box until it takes focus, then returns to normal flow inside the row so
   the two links never overlap each other. */
.skip-links {
  position: fixed;
  top: 8px;
  left: 88px;
  z-index: var(--z-overlay);
  display: flex;
  gap: 8px;
}

.skip-link {
  display: inline-block;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  white-space: nowrap;
  clip-path: inset(50%);
}

.skip-link:focus-visible {
  overflow: visible;
  width: auto;
  height: auto;
  padding: 6px 12px;
  border: 1px solid var(--accent-color);
  border-radius: var(--control-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  text-decoration: none;
  clip-path: none;
}

.app-container[data-shell='companion'] {
  border: 0;
  box-shadow: none;
  overflow: visible;
}

/* 可拖拽区域 - 在 macOS 上 */
.titlebar-drag-region {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  -webkit-app-region: drag;
  z-index: var(--z-chrome);
}

/* 可交互元素需要排除拖拽 */
.titlebar-drag-region button,
.titlebar-drag-region tool-button,
.titlebar-drag-region a,
.titlebar-drag-region input {
  -webkit-app-region: no-drag;
}
</style>
