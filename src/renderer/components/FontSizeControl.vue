<template>
  <div class="control-group">
    <label>字体大小 {{ config?.ui.fontSize }}px</label>
    <input
      type="range"
      min="10"
      max="32"
      :value="config?.ui.fontSize"
      @input="setFontSize(Number($event.target.value))"
    />
  </div>
</template>

<script setup lang="ts">
import { useAppConfig } from '../composables/useAppConfig';

const { config, setFontSize } = useAppConfig();
</script>
