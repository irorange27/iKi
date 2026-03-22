<template>
  <div v-if="hasSummary" class="chat-message-references">
    <div class="reference-summary">
      <span
        v-if="affectSummary.label"
        class="reference-summary-item"
        :title="affectTooltip"
      >
        <Heart :size="14" class="reference-summary-icon" />
        affect
      </span>
      <span
        v-if="memorySummary.items.length > 0"
        class="reference-summary-item"
        :title="memoryTooltip"
      >
        <Brain :size="14" class="reference-summary-icon" />
        {{ memorySummary.items.length }} memories
      </span>
      <span
        v-if="toolSummary.count > 0"
        class="reference-summary-item"
        :title="toolTooltip"
      >
        <Wrench :size="14" class="reference-summary-icon" />
        {{ toolSummary.count }} tools
      </span>
      <span
        v-if="skillSummary.items.length > 0"
        class="reference-summary-item"
        :title="skillTooltip"
      >
        <Sparkles :size="14" class="reference-summary-icon" />
        {{ skillSummary.items.length }} skills
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { UIMessage } from 'ai';
import { Brain, Heart, Sparkles, Wrench } from 'lucide-vue-next';

import {
  getAffectReferenceSummary,
  getMemoryReferenceSummary,
  getSkillReferenceSummary,
  getToolReferenceSummary,
  hasReferenceSummary,
} from '../../modules/chat/ui_message_references';

const props = defineProps<{
  message: UIMessage;
}>();

const hasSummary = computed(
  () => props.message.role === 'assistant' && hasReferenceSummary(props.message)
);
const toolSummary = computed(() => getToolReferenceSummary(props.message));
const skillSummary = computed(() => getSkillReferenceSummary(props.message));
const memorySummary = computed(() => getMemoryReferenceSummary(props.message));
const affectSummary = computed(() => getAffectReferenceSummary(props.message));

const toolTooltip = computed(() =>
  toolSummary.value.names.length > 0
    ? `Tools: ${toolSummary.value.names.join(', ')}`
    : 'Tools used in this reply'
);

const skillTooltip = computed(() => {
  if (skillSummary.value.items.length === 0) return 'No skills used';
  return skillSummary.value.items.map(skill => skill.name).join(', ');
});

const memoryTooltip = computed(() =>
  memorySummary.value.query
    ? `Memory query: ${memorySummary.value.query}`
    : 'Memory references used in this reply'
);

const affectTooltip = computed(() => {
  if (!affectSummary.value.label) return 'No affect signal';
  const details: string[] = [affectSummary.value.label];
  if (affectSummary.value.confidence !== null) {
    details.push(`${formatPercent(affectSummary.value.confidence)} confidence`);
  }
  if (affectSummary.value.guardActive) {
    details.push('guarded');
  }
  return details.join(' · ');
});

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;
</script>

<style scoped>
.chat-message-references {
  min-width: 0;
}

.reference-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
}

.reference-summary-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: default;
  font-size: 13px;
  color: var(--reference-inline-color);
}

.reference-summary-icon {
  flex-shrink: 0;
}
</style>
