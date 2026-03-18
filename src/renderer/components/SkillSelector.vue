<template>
  <div
    class="relative"
    @mouseenter="openSkillSelector"
    @mouseleave="scheduleCloseSkillSelector"
  >
    <button
      class="relative h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn"
      :class="{ 'text-accent': isAutoSkillMode || selectedSkillIds.length > 0 }"
      @click="showSkillSelector = !showSkillSelector"
      @mouseenter="openSkillSelector"
      @mouseleave="scheduleCloseSkillSelector"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        />
      </svg>
      <span
        v-if="isAutoSkillMode || selectedSkillIds.length > 0"
        class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white"
      >
        {{ isAutoSkillMode ? 'A' : selectedSkillIds.length }}
      </span>
    </button>

    <!-- Skill Selector Menu -->
    <div
      v-if="showSkillSelector"
      class="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden"
      @mouseenter="openSkillSelector"
      @mouseleave="scheduleCloseSkillSelector"
    >
      <div class="p-3 border-b border-color bg-tertiary">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-primary">Skills</span>
        </div>
        <div class="mt-1 text-xs text-muted leading-snug">
          Inject reusable instructions (workflows, best practices) into the next
          response. Skills are loaded from your local filesystem.
        </div>

        <div class="mt-2 flex items-center gap-2">
          <button
            class="tool-mode-btn"
            :class="{ active: isAutoSkillMode }"
            @click="toggleAutoSkillMode"
          >
            Auto
          </button>
          <div class="flex-1" />
          <button
            class="tool-action-btn"
            :disabled="isAutoSkillMode"
            @click="selectAllSkills"
          >
            Select all
          </button>
          <button
            class="tool-action-btn"
            :disabled="isAutoSkillMode"
            @click="clearAllSkills"
          >
            Clear
          </button>
        </div>
        <div v-if="isAutoSkillMode" class="mt-2 text-xs text-accent leading-snug">
          iKi will automatically pick relevant skills based on your message.
        </div>
      </div>
      <div class="max-h-72 overflow-y-auto p-2">
        <div v-if="availableSkills.length === 0" class="p-4 text-center text-sm text-muted">
          No skills found.
        </div>
        <button
          v-for="skill in availableSkills"
          :key="skill.id"
          class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between group"
          :disabled="isAutoSkillMode"
          :class="{
            'text-accent bg-hover/50': isSkillSelected(skill.id) && !isAutoSkillMode,
            'opacity-60 cursor-not-allowed': isAutoSkillMode,
          }"
          @click="toggleSkill(skill.id)"
        >
          <div class="flex flex-col">
            <span class="font-medium">{{ skill.name }}</span>
            <span class="text-[10px] text-muted truncate max-w-[180px]">
              {{ skill.description || skill.path || skill.id }}
            </span>
          </div>
          <div
            class="flex h-4 w-4 items-center justify-center rounded border border-color"
            :class="{ 'bg-accent border-accent': isSkillSelected(skill.id) }"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { SkillSummary } from '../../shared/types/skill';

interface ElectronSkillsApi {
  skills?: {
    list?: () => Promise<unknown>;
  };
}

const props = defineProps<{
  skillIds: string[];
  mode: 'manual' | 'auto';
}>();

const emit = defineEmits<{
  (event: 'update:skillIds', value: string[]): void;
  (event: 'update:mode', value: 'manual' | 'auto'): void;
}>();

const electronAPI = (window as Window & { electronAPI?: ElectronSkillsApi }).electronAPI;

const showSkillSelector = ref(false);
const availableSkills = ref<SkillSummary[]>([]);
const skillSelectorCloseTimer = ref<number | null>(null);
const isAutoSkillMode = computed(() => props.mode === 'auto');
const selectedSkillIds = computed(() => props.skillIds);

const normalizeSkills = (input: unknown): SkillSummary[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((skill: unknown) => {
      if (!skill || typeof skill !== 'object') return null;
      const { id, name, description, source, path } = skill as SkillSummary;
      if (typeof id !== 'string' || id.trim().length === 0) return null;
      if (typeof name !== 'string' || name.trim().length === 0) return null;
      return {
        id,
        name,
        description: typeof description === 'string' ? description : '',
        source: source === 'codex' || source === 'user' ? source : 'user',
        path: typeof path === 'string' ? path : undefined,
      };
    })
    .filter((skill): skill is SkillSummary => Boolean(skill));
};

const loadAvailableSkills = async () => {
  try {
    const skills = await electronAPI?.skills?.list?.();
    availableSkills.value = normalizeSkills(skills);
  } catch (error) {
    console.error('Failed to load skills:', error);
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
  emit('update:skillIds', availableSkills.value.map(skill => skill.id));
};

const clearAllSkills = () => {
  if (isAutoSkillMode.value) return;
  emit('update:skillIds', []);
};

const openSkillSelector = () => {
  if (skillSelectorCloseTimer.value !== null) {
    window.clearTimeout(skillSelectorCloseTimer.value);
    skillSelectorCloseTimer.value = null;
  }
  showSkillSelector.value = true;
};

const scheduleCloseSkillSelector = () => {
  if (skillSelectorCloseTimer.value !== null) {
    window.clearTimeout(skillSelectorCloseTimer.value);
  }
  skillSelectorCloseTimer.value = window.setTimeout(() => {
    showSkillSelector.value = false;
    skillSelectorCloseTimer.value = null;
  }, 180);
};

onMounted(() => {
  void loadAvailableSkills();
});

onUnmounted(() => {
  if (skillSelectorCloseTimer.value !== null) {
    window.clearTimeout(skillSelectorCloseTimer.value);
    skillSelectorCloseTimer.value = null;
  }
});
</script>

<style scoped>
.text-primary {
  color: var(--text-primary);
}

.text-secondary {
  color: var(--text-secondary);
}

.text-muted {
  color: var(--text-muted);
}

.text-accent {
  color: var(--accent-color);
}

.border-color {
  border-color: var(--border-color);
}

.bg-secondary {
  background-color: var(--bg-secondary);
}

.bg-tertiary {
  background-color: var(--bg-tertiary);
}

.shadow-xl {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.2),
    0 10px 10px -5px rgba(0, 0, 0, 0.1);
}

.icon-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.bg-\[\#4a9eff\] {
  background-color: var(--accent-color);
}

.bg-hover\/50 {
  background-color: rgba(var(--accent-rgb, 74, 158, 255), 0.1);
}

.tool-mode-btn {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
}

.tool-mode-btn.active {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.18);
  border-color: rgba(var(--accent-rgb, 74, 158, 255), 0.35);
  color: var(--text-primary);
}

.tool-action-btn {
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
}

.tool-action-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
