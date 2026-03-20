<template>
  <div class="flex max-w-md flex-col items-center gap-8 text-center">
    <!-- Avatar -->
    <!-- <div class="h-24 w-24 overflow-hidden rounded-2xl bg-white">
        <img src="/images/image.png" alt="Alma" class="h-full w-full object-cover" />
      </div> -->

    <!-- Title -->
    <h1 class="ui-text-primary font-serif text-5xl font-normal">iKi</h1>

    <!-- Subtitle -->
    <p class="ui-text-secondary">An elegant desktop for AI provider orchestration</p>

    <!-- Buttons -->
    <div class="flex w-full flex-col gap-3">
      <button
        class="w-full rounded-lg px-6 py-3 text-base font-medium text-white transition-colors btn-primary"
        @click="$emit('new-chat')"
      >
        New Chat
      </button>
      <div class="flex gap-3">
        <button
          class="flex-1 rounded-lg border bg-transparent px-6 py-3 text-white text-base font-small transition-colors btn-secondary"
        >
          Configure Provider
        </button>
        <button
          class="flex-1 rounded-lg border bg-transparent px-6 py-3 text-white text-base font-small transition-colors btn-secondary"
          @click="openSettings"
        >
          Settings
        </button>
      </div>
    </div>

    <!-- Info Text -->
    <p class="ui-text-muted text-sm">Please configure at least one AI provider to start chatting</p>
  </div>
</template>

<script setup lang="ts">
defineEmits(['new-chat']);

const openSettings = () => {
  // @ts-ignore
  window.electronAPI?.openSettings();
};
</script>

<style scoped>
.btn-primary {
  background-color: var(--accent-color);
}
.btn-primary:hover {
  background-color: var(--accent-hover);
}

.btn-secondary {
  border-color: var(--border-color);
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}
</style>
