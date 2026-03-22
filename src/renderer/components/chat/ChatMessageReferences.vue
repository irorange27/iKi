<template>
  <div v-if="hasSummary" class="chat-message-references">
    <div class="reference-summary">
      <button
        v-if="affectSummary.label"
        type="button"
        class="reference-summary-item"
        :class="{ 'is-active': expandedCategory === 'affect' }"
        :title="affectTooltip"
        @click.stop="toggleReferencePanel('affect')"
      >
        <Heart :size="14" class="reference-summary-icon" />
        affect
      </button>
      <button
        v-if="memorySummary.items.length > 0"
        type="button"
        class="reference-summary-item"
        :class="{ 'is-active': expandedCategory === 'memory' }"
        :title="memoryTooltip"
        @click.stop="toggleReferencePanel('memory')"
      >
        <Brain :size="14" class="reference-summary-icon" />
        {{ memorySummary.items.length }} memories
      </button>
      <button
        v-if="toolSummary.count > 0"
        type="button"
        class="reference-summary-item"
        :class="{ 'is-active': expandedCategory === 'tools' }"
        :title="toolTooltip"
        @click.stop="toggleReferencePanel('tools')"
      >
        <Wrench :size="14" class="reference-summary-icon" />
        {{ toolSummary.count }} tools
      </button>
      <button
        v-if="skillSummary.items.length > 0"
        type="button"
        class="reference-summary-item"
        :class="{ 'is-active': expandedCategory === 'skills' }"
        :title="skillTooltip"
        @click.stop="toggleReferencePanel('skills')"
      >
        <Sparkles :size="14" class="reference-summary-icon" />
        {{ skillSummary.items.length }} skills
      </button>
    </div>

    <div v-if="expandedCategory" class="reference-panel">
      <div v-if="expandedCategory === 'tools'">
        <div class="reference-panel-label">Tools</div>
        <ul class="reference-panel-list">
          <li
            v-for="entry in toolSummary.items"
            :key="entry.name"
            class="reference-panel-item"
          >
            <span class="reference-panel-item-name">{{ entry.name }}</span>
            <span class="reference-panel-item-meta">{{ entry.count }} calls</span>
          </li>
        </ul>
      </div>

      <div v-else-if="expandedCategory === 'skills'">
        <div class="reference-panel-label">Skills</div>
        <ul class="reference-panel-list">
          <li
            v-for="skill in skillSummary.items"
            :key="skill.id"
            class="reference-panel-item reference-panel-item-action"
          >
            <button
              type="button"
              class="reference-panel-link"
              @click="emit('open-skill', skill.id)"
            >
              <span class="reference-panel-item-name">{{ skill.name }}</span>
              <span class="reference-panel-item-meta">{{ skill.sourceLabel }}</span>
              <span v-if="skill.description" class="reference-panel-item-description">
                {{ skill.description }}
              </span>
              <ExternalLink :size="13" class="reference-panel-link-icon" />
            </button>
          </li>
        </ul>
      </div>

      <div v-else-if="expandedCategory === 'memory'">
        <div class="reference-panel-label">Memory</div>
        <div v-if="memorySummary.query" class="reference-panel-query">
          {{ memorySummary.query }}
        </div>
        <ul class="reference-panel-list">
          <li
            v-for="entry in memorySummary.items"
            :key="entry.id || entry.summary"
            class="reference-panel-item"
          >
            <div class="reference-panel-item-row">
              <span v-if="entry.score !== null" class="reference-panel-score">
                {{ formatMemoryMatchScore(entry.score) }}
              </span>
              <span
                v-if="entry.sourceMessageCount !== null"
                class="reference-panel-item-meta"
              >
                {{ formatMemorySourceCount(entry.sourceMessageCount) }}
              </span>
              <span v-if="entry.updatedAt" class="reference-panel-item-meta">
                {{ formatShortTimestamp(entry.updatedAt) }}
              </span>
            </div>
            <div class="reference-panel-item-description">
              {{ entry.summary }}
            </div>
            <div v-if="entry.tags.length > 0" class="reference-panel-tags">
              <span v-for="tag in entry.tags" :key="tag" class="reference-panel-tag">
                {{ tag }}
              </span>
            </div>
          </li>
        </ul>
      </div>

      <div v-else-if="expandedCategory === 'affect'">
        <div class="reference-panel-label">Affect</div>
        <ul class="reference-panel-list">
          <li class="reference-panel-item">
            <div class="reference-panel-item-row">
              <span class="reference-panel-item-name">{{ affectSummary.label }}</span>
              <span v-if="affectSummary.confidence !== null" class="reference-panel-item-meta">
                {{ formatPercent(affectSummary.confidence) }} confidence
              </span>
              <span class="reference-panel-item-meta">
                {{ affectSummary.source === 'realtime' ? 'Realtime' : 'History' }}
              </span>
              <span
                v-if="affectSummary.guardActive"
                class="reference-panel-item-meta reference-panel-warning"
              >
                guarded
              </span>
            </div>
            <div class="reference-panel-item-description">
              <template v-if="affectSummary.valence !== null">
                valence {{ formatSigned(affectSummary.valence) }}
              </template>
              <template v-if="affectSummary.valence !== null && affectSummary.arousal !== null">
                ·
              </template>
              <template v-if="affectSummary.arousal !== null">
                arousal {{ affectSummary.arousal.toFixed(2) }}
              </template>
              <template
                v-if="affectSummary.sampleCount !== null || affectSummary.windowMinutes !== null"
              >
                <span v-if="affectSummary.valence !== null || affectSummary.arousal !== null">
                  ·
                </span>
                <span v-if="affectSummary.sampleCount !== null">
                  {{ affectSummary.sampleCount }} samples
                </span>
                <span
                  v-if="affectSummary.sampleCount !== null && affectSummary.windowMinutes !== null"
                >
                  ·
                </span>
                <span v-if="affectSummary.windowMinutes !== null">
                  ~{{ Math.max(1, Math.round(affectSummary.windowMinutes)) }}m window
                </span>
              </template>
            </div>
            <div v-if="affectSummary.emotions.length > 0" class="reference-panel-tags">
              <span
                v-for="emotion in affectSummary.emotions"
                :key="emotion.label"
                class="reference-panel-tag"
              >
                {{ emotion.label }} {{ formatPercent(emotion.score) }}
              </span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { UIMessage } from 'ai';
import { Brain, ExternalLink, Heart, Sparkles, Wrench } from 'lucide-vue-next';

import {
  getAffectReferenceSummary,
  getMemoryReferenceSummary,
  getSkillReferenceSummary,
  getToolReferenceSummary,
  hasReferenceSummary,
} from '../../modules/chat/ui_message_references';

type ReferenceCategory = 'tools' | 'skills' | 'memory' | 'affect';

const props = defineProps<{
  message: UIMessage;
}>();

const emit = defineEmits<{
  (event: 'open-skill', skillId: string): void;
}>();

const expandedCategory = ref<ReferenceCategory | null>(null);

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

const toggleReferencePanel = (category: ReferenceCategory) => {
  expandedCategory.value = expandedCategory.value === category ? null : category;
};

const formatShortTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString();
};

const formatMemoryMatchScore = (score: number): string => `${score.toFixed(3)} match`;

const formatMemorySourceCount = (count: number): string =>
  `${count} source ${count === 1 ? 'message' : 'messages'}`;

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatSigned = (value: number): string => (value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2));

watch(
  () => ({
    messageId: props.message.id,
    hasTools: toolSummary.value.count > 0,
    hasSkills: skillSummary.value.items.length > 0,
    hasMemory: memorySummary.value.items.length > 0,
    hasAffect: Boolean(affectSummary.value.label),
  }),
  value => {
    if (
      (expandedCategory.value === 'tools' && !value.hasTools) ||
      (expandedCategory.value === 'skills' && !value.hasSkills) ||
      (expandedCategory.value === 'memory' && !value.hasMemory) ||
      (expandedCategory.value === 'affect' && !value.hasAffect)
    ) {
      expandedCategory.value = null;
    }
  },
  { immediate: true }
);
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
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--reference-inline-color);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--reference-inline-underline);
  text-underline-offset: 4px;
}

.reference-summary-item:hover,
.reference-summary-item.is-active {
  color: var(--reference-inline-hover);
  text-decoration-color: var(--reference-inline-underline);
}

.reference-summary-icon {
  flex-shrink: 0;
}

.reference-panel {
  margin-bottom: 12px;
  padding: 10px 0 0;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
}

.reference-panel-label {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.reference-panel-query {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.reference-panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.reference-panel-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
}

.reference-panel-item-action {
  padding: 0;
  overflow: hidden;
}

.reference-panel-link {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  align-items: start;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.reference-panel-link:hover {
  background: color-mix(in srgb, var(--accent-color) 5%, transparent);
}

.reference-panel-link-icon {
  grid-column: 2 / 3;
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--text-muted);
}

.reference-panel-item-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.reference-panel-item-name {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}

.reference-panel-item-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.reference-panel-warning {
  color: var(--status-danger-color);
}

.reference-panel-item-description {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.reference-panel-score {
  display: inline-flex;
  align-items: center;
  padding: 3px 7px;
  border-radius: 999px;
  font-weight: 650;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.reference-panel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reference-panel-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}
</style>
