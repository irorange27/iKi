<template>
  <div v-if="hasSummary" class="chat-message-references">
    <div class="reference-summary">
      <span v-if="affectSummary.label" class="reference-summary-item" :title="affectTooltip">
        <Heart :size="14" class="reference-summary-icon" />
        {{ t('chat.references.affect') }}
      </span>
      <span
        v-if="memorySummary.items.length > 0"
        class="reference-summary-item"
        :title="memoryTooltip"
      >
        <Brain :size="14" class="reference-summary-icon" />
        {{ t('chat.references.memories', { count: memorySummary.items.length }) }}
      </span>
      <span
        v-if="toolSummary.kindCount > 0"
        class="reference-summary-item"
        :title="toolTooltip"
      >
        <Wrench :size="14" class="reference-summary-icon" />
        {{ t('chat.references.tools', { count: toolSummary.kindCount }) }}
      </span>
      <span
        v-if="skillSummary.items.length > 0"
        class="reference-summary-item"
        :title="skillTooltip"
      >
        <Sparkles :size="14" class="reference-summary-icon" />
        {{ t('chat.references.skills', { count: skillSummary.items.length }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Brain, Heart, Sparkles, Wrench } from 'lucide-vue-next';
import type { ChatUiMessage } from '../../../shared/chat/message_parts';
import { useI18n } from '../../i18n';

import {
  getAffectReferenceSummary,
  getMemoryReferenceSummary,
  getSkillReferenceSummary,
  getToolReferenceSummary,
  hasReferenceSummary,
} from '../../modules/chat/ui_message_references';

const props = defineProps<{
  message: ChatUiMessage;
}>();

const { t } = useI18n();

const hasSummary = computed(
  () => props.message.role === 'assistant' && hasReferenceSummary(props.message)
);
const toolSummary = computed(() => getToolReferenceSummary(props.message));
const skillSummary = computed(() => getSkillReferenceSummary(props.message));
const memorySummary = computed(() => getMemoryReferenceSummary(props.message));
const affectSummary = computed(() => getAffectReferenceSummary(props.message));

const toolTooltip = computed(() => {
  return t('chat.references.toolTooltip', { names: toolSummary.value.names.join(', ') });
});

const skillTooltip = computed(() => {
  if (skillSummary.value.items.length === 0) return t('chat.references.noSkillsLoaded');

  const lines = [
    t('chat.references.loadedSkills', {
      names: skillSummary.value.items.map(skill => skill.name).join(', '),
    }),
  ];
  if (skillSummary.value.selectedOnlyItems.length > 0) {
    lines.push(
      t('chat.references.selectedNotLoaded', {
        names: skillSummary.value.selectedOnlyItems.map(skill => skill.name).join(', '),
      })
    );
  }
  if (skillSummary.value.selectedItems.length > 0) {
    lines.push(t('chat.references.selectionMode', { mode: skillSummary.value.mode }));
  }
  return lines.join('\n');
});

const memoryTooltip = computed(() =>
  memorySummary.value.query
    ? t('chat.references.memoryQuery', { query: memorySummary.value.query })
    : t('chat.references.memoryFallback')
);

const affectTooltip = computed(() => {
  if (!affectSummary.value.label) return t('chat.references.noAffect');
  const details: string[] = [affectSummary.value.label];
  if (affectSummary.value.confidence !== null) {
    details.push(
      t('chat.references.confidence', {
        value: formatPercent(affectSummary.value.confidence),
      })
    );
  }
  if (affectSummary.value.guardActive) {
    details.push(t('chat.references.guarded'));
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
  cursor: help;
  font-size: 13px;
  color: var(--reference-inline-color);
}

.reference-summary-icon {
  flex-shrink: 0;
}
</style>
