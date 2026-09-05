<template>
  <div class="composer-toolbar-left flex items-center">
    <WorkspaceSelector
      :selected-workspace-id="props.selectedWorkspaceId ?? null"
      :locked="props.workspaceLocked"
      :thread-id="props.threadId ?? null"
      @update:selected-workspace-id="emit('update:selectedWorkspaceId', $event)"
    />
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
    <ReasoningSelector
      :model-value="props.reasoningEffort ?? ''"
      @update:model-value="emit('update:reasoningEffort', $event)"
    />
    <ChatModelSelector
      :available-providers="props.availableProviders"
      :selected-provider="props.selectedProvider"
      :selected-model="props.selectedModel"
      @select="emit('selectProviderModel', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import type { Provider } from '@iki/backend/types/provider';
import AutonomousSelector from './AutonomousSelector.vue';
import ChatModelSelector from './ChatModelSelector.vue';
import ReasoningSelector from './ReasoningSelector.vue';
import SkillSelector from './SkillSelector.vue';
import ToolSelector from './ToolSelector.vue';
import WorkspaceSelector from './WorkspaceSelector.vue';

const props = defineProps<{
  selectedWorkspaceId?: string | null;
  workspaceLocked?: boolean;
  threadId?: string | null;
  selectedSkillIds: string[];
  skillMode: 'manual' | 'auto';
  selectedTools: string[];
  selectedMcpServerIds: string[];
  toolMode: 'manual' | 'auto';
  autonomousActive: boolean;
  autonomousMaxIterations: number;
  reasoningEffort?: string;
  availableProviders: Provider[];
  selectedProvider: Provider | null;
  selectedModel: string;
}>();

const emit = defineEmits<{
  (event: 'update:selectedWorkspaceId', value: string | null): void;
  (event: 'update:selectedSkillIds', value: string[]): void;
  (event: 'update:skillMode', value: 'manual' | 'auto'): void;
  (event: 'update:selectedTools', value: string[]): void;
  (event: 'update:selectedMcpServerIds', value: string[]): void;
  (event: 'update:toolMode', value: 'manual' | 'auto'): void;
  (event: 'update:autonomousActive', value: boolean): void;
  (event: 'update:autonomousMaxIterations', value: number): void;
  (event: 'update:reasoningEffort', value: string): void;
  (event: 'selectProviderModel', payload: { provider: Provider; model: string }): void;
}>();
</script>

<style scoped>
.composer-toolbar-left {
  gap: 8px;
  min-width: 0;
}
</style>
