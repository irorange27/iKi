<template>
  <div class="app-container">
    <div class="titlebar-drag-region"></div>
    <SettingsView v-if="isSettings" :initial-section="settingsSection" @close="closeSettings" />
    <ChatView v-else />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import SettingsView from './views/SettingsView.vue';
import ChatView from './views/ChatView.vue';
import { useAppConfig } from './composables/useAppConfig';
import { useAppLocale } from './composables/useAppLocale';
import { createSidebar } from './composables/useSidebar';
import { useTheme } from './composables/useTheme';

createSidebar();
useTheme();
useAppLocale();
const electronAPI = window.electronAPI;
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
});

const isSettings = computed(() => currentHash.value.includes('settings'));
const settingsSection = computed(() => extractSettingsSection(currentHash.value));
const closeSettings = () => {
  electronAPI?.closeWindow?.();
};

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

/* 可拖拽区域 - 在 macOS 上 */
.titlebar-drag-region {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  -webkit-app-region: drag;
  z-index: 9999;
}

/* 可交互元素需要排除拖拽 */
.titlebar-drag-region button,
.titlebar-drag-region tool-button,
.titlebar-drag-region a,
.titlebar-drag-region input {
  -webkit-app-region: no-drag;
}
</style>
