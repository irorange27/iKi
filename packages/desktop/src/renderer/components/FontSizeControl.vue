<template>
  <div class="control-group">
    <label>字体大小 {{ config?.ui.fontSize }}px</label>
    <input
      type="range"
      min="10"
      max="32"
      :value="config?.ui.fontSize"
      @input="handleInput"
    />
  </div>
</template>

<script setup lang="ts">
import { useAppConfig } from '../composables/useAppConfig';

const { config, updateUi } = useAppConfig();

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;
  updateUi('fontSize', Number(target.value));
};
</script>
