<template>
  <div class="composer-toolbar-left flex items-center">
    <WorkspaceSelector v-if="props.showWorkspace" :locked="props.workspaceLocked" />
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
import WorkspaceSelector from './WorkspaceSelector.vue';

const props = defineProps<{
  workspaceLocked?: boolean;
  showWorkspace?: boolean;
  autonomousActive: boolean;
  autonomousMaxIterations: number;
}>();

const emit = defineEmits<{
  (event: 'update:autonomousActive', value: boolean): void;
  (event: 'update:autonomousMaxIterations', value: number): void;
}>();
</script>

<style scoped>
.composer-toolbar-left {
  gap: 8px;
  min-width: 0;
}
</style>
