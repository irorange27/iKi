<template>
  <div class="composer-toolbar-left flex items-center">
    <AutonomousSelector
      :active="props.autonomousActive"
      :max-iterations="props.autonomousMaxIterations"
      @update:active="emit('update:autonomousActive', $event)"
      @update:max-iterations="emit('update:autonomousMaxIterations', $event)"
    />
    <ReasoningSelector />
  </div>
</template>

<script setup lang="ts">
import AutonomousSelector from './AutonomousSelector.vue';
import ReasoningSelector from './ReasoningSelector.vue';

const props = defineProps<{
  autonomousActive: boolean;
  autonomousMaxIterations: number;
}>();

const emit = defineEmits<{
  'update:autonomousActive': [value: boolean];
  'update:autonomousMaxIterations': [value: number];
}>();
</script>

<style scoped>
.composer-toolbar-left {
  gap: 8px;
  min-width: 0;
}
</style>
