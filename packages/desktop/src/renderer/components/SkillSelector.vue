<template>
  <PopoverRoot v-model:open="showSkillSelector" @update:open="value => { if (value) void loadAvailableSkills(); }">
  <PopoverTrigger as-child>
    <button
      class="composer-chip composer-chip--reveal"
      :class="{ 'composer-chip--active': isAutoSkillMode || selectedSkillIds.length > 0 }"
      :title="triggerTitle"
      :aria-label="triggerTitle"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        />
      </svg>
      <span class="composer-chip-label">{{ t('chat.skills.title') }}</span>
      <span
        v-if="!isAutoSkillMode && selectedSkillIds.length > 0"
        class="composer-chip-count"
      >
        {{ selectedSkillIds.length }}
      </span>
    </button>
  </PopoverTrigger>
  <PopoverPortal>
    <PopoverContent
      side="top"
      align="start"
      :side-offset="8"
      class="selector-panel"
    >
      <div class="selector-panel-header">
        <div class="flex items-center justify-between">
          <span class="selector-panel-title ui-text-primary">{{ t('chat.skills.title') }}</span>
        </div>
        <div class="selector-panel-description ui-text-muted">
          {{ t('chat.skills.description') }}
        </div>

        <div class="selector-panel-toolbar">
          <button
            class="selector-mode-btn"
            :class="{ active: isAutoSkillMode }"
            @click="toggleAutoSkillMode"
          >
            {{ t('chat.tools.auto') }}
          </button>
          <div class="selector-toolbar-spacer" />
          <button class="selector-action-btn" :disabled="isAutoSkillMode" @click="selectAllSkills">
            {{ t('chat.tools.selectAll') }}
          </button>
          <button class="selector-action-btn" :disabled="isAutoSkillMode" @click="clearAllSkills">
            {{ t('chat.tools.clear') }}
          </button>
        </div>
        <div v-if="isAutoSkillMode" class="ui-text-accent mt-2 text-xs leading-snug">
          {{ t('chat.skills.autoHint') }}
        </div>
      </div>
      <div class="selector-list">
        <div v-if="availableSkills.length === 0" class="selector-empty-state">
          {{ t('chat.skills.noSkills') }}
        </div>
        <button
          v-for="skill in availableSkills"
          :key="skill.id"
          class="selector-item"
          :disabled="isAutoSkillMode"
          :class="{
            'selector-item-selected': isSkillSelected(skill.id) && !isAutoSkillMode,
            'selector-item-disabled': isAutoSkillMode,
          }"
          @click="toggleSkill(skill.id)"
        >
          <div class="selector-item-copy">
            <span class="font-medium">{{ skill.name }}</span>
            <span class="selector-item-description selector-item-description-truncate">
              {{ skill.description || skill.path || skill.id }}
            </span>
          </div>
          <div
            class="selector-check"
            :class="{ 'selector-check-active': isSkillSelected(skill.id) }"
          >
            <svg
              v-if="isSkillSelected(skill.id)"
              class="h-3 w-3 text-white"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
        </button>
      </div>
    </PopoverContent>
  </PopoverPortal>
</PopoverRoot>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import type { SkillSummary } from '@iki/backend/types/skill';
import { createLogger } from '../logger';
import { useI18n } from '../i18n';
import { getElectronApiSliceMethod } from '../services/electron_api';
const props = defineProps<{
  skillIds: string[];
  mode: 'manual' | 'auto';
}>();

const emit = defineEmits<{
  (event: 'update:skillIds', value: string[]): void;
  (event: 'update:mode', value: 'manual' | 'auto'): void;
}>();

const listSkills = getElectronApiSliceMethod('skills', 'list');
const skillSelectorLogger = createLogger({ module: 'skill_selector' });
const { t } = useI18n();

const showSkillSelector = ref(false);
const availableSkills = ref<SkillSummary[]>([]);
const selectedSkillIds = computed(() => props.skillIds);
const isAutoSkillMode = computed(() => props.mode === 'auto');

const triggerTitle = computed(() => {
  if (isAutoSkillMode.value) {
    return t('chat.skills.trigger.auto');
  }
  if (selectedSkillIds.value.length > 0) {
    return t('chat.skills.trigger.selected', { count: selectedSkillIds.value.length });
  }
  return t('chat.skills.trigger.choose');
});

const normalizeSkills = (input: unknown): SkillSummary[] => {
  if (!Array.isArray(input)) return [];
  const normalized: SkillSummary[] = [];
  for (const skill of input) {
    if (!skill || typeof skill !== 'object') continue;
    const { id, name, description, source, path } = skill as SkillSummary;
    if (typeof id !== 'string' || id.trim().length === 0) continue;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    normalized.push({
      id,
      name,
      description: typeof description === 'string' ? description : '',
      source: source === 'codex' || source === 'user' ? source : 'user',
      path: typeof path === 'string' ? path : undefined,
    });
  }
  return normalized;
};

const loadAvailableSkills = async () => {
  try {
    const skills = listSkills ? await listSkills() : [];
    availableSkills.value = normalizeSkills(skills);
  } catch (error) {
    skillSelectorLogger.event({
      level: 'error',
      event: 'skills.load',
      outcome: 'failed',
      error,
    });
    availableSkills.value = [];
  }
};

const toggleAutoSkillMode = () => {
  emit('update:mode', isAutoSkillMode.value ? 'manual' : 'auto');
};

const isSkillSelected = (skillId: string) => selectedSkillIds.value.includes(skillId);

const toggleSkill = (skillId: string) => {
  if (isAutoSkillMode.value) return;
  const next = isSkillSelected(skillId)
    ? selectedSkillIds.value.filter(id => id !== skillId)
    : [...selectedSkillIds.value, skillId];
  emit('update:skillIds', next);
};

const selectAllSkills = () => {
  if (isAutoSkillMode.value) return;
  emit(
    'update:skillIds',
    availableSkills.value.map(skill => skill.id)
  );
};

const clearAllSkills = () => {
  if (isAutoSkillMode.value) return;
  emit('update:skillIds', []);
};

</script>

<style scoped>
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
