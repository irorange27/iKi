<template>
  <div class="app-container">
    <div class="titlebar-drag-region"></div>
    <SettingsView v-if="isSettings" @close="closeSettings" />
    <ChatView v-else />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import SettingsView from './views/SettingsView.vue';
import ChatView from './views/ChatView.vue';
import { useAppConfig } from './composables/useAppConfig';
import { createSidebar } from './composables/useSidebar';
import { useTheme } from './composables/useTheme';

const sidebar = createSidebar();
useTheme();
const currentHash = ref(window.location.hash);
const updateHash = () => {
  currentHash.value = window.location.hash;
};
window.addEventListener('hashchange', updateHash);

const isSettings = computed(() => currentHash.value.includes('settings'));
const closeSettings = () => {
  // @ts-ignore
  window.electronAPI?.closeWindow();
};

useAppConfig();
</script>

<style>
@import './assets/styles/variables.css';

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
