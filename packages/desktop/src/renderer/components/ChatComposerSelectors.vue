<template>
  <div class="composer-toolbar-left flex items-center">
    <WorkspaceSelector v-if="props.showWorkspace" :locked="props.workspaceLocked" />
    <SkillSelector
      :skill-ids="props.selectedSkillIds"
      :mode="props.skillMode"
      @update:skill-ids="emit('update:selectedSkillIds', $event)"
      @update:mode="emit('update:skillMode', $event)"
    />
    <ToolSelector
      :tools="props.selectedTools"
      :mcp-server-ids="props.selectedMcpServerIds"
      :mode="props.toolMode"
      @update:tools="emit('update:selectedTools', $event)"
      @update:mcp-server-ids="emit('update:selectedMcpServerIds', $event)"
      @update:mode="emit('update:toolMode', $event)"
    />
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
import SkillSelector from './SkillSelector.vue';
import ToolSelector from './ToolSelector.vue';
import WorkspaceSelector from './WorkspaceSelector.vue';

const props = defineProps<{
  workspaceLocked?: boolean;
  showWorkspace?: boolean;
  selectedSkillIds: string[];
  skillMode: 'manual' | 'auto';
  selectedTools: string[];
  selectedMcpServerIds: string[];
  toolMode: 'manual' | 'auto';
  autonomousActive: boolean;
  autonomousMaxIterations: number;
}>();

const emit = defineEmits<{
  (event: 'update:selectedSkillIds', value: string[]): void;
  (event: 'update:skillMode', value: 'manual' | 'auto'): void;
  (event: 'update:selectedTools', value: string[]): void;
  (event: 'update:selectedMcpServerIds', value: string[]): void;
  (event: 'update:toolMode', value: 'manual' | 'auto'): void;
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
