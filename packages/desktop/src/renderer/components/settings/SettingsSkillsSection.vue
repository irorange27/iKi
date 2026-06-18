<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="skills-toolbar">
        <div class="skills-toolbar-left">
          <div class="card-title">{{ t('settings.skills.title') }}</div>
          <div class="skills-subtitle">
            {{ t('settings.skills.availableCount', { count: filteredSkills.length }) }}
          </div>
        </div>
        <div class="skills-toolbar-actions">
          <button
            class="secondary-btn skills-btn"
            @click="() => refreshSkills()"
            :disabled="skillsLoading"
          >
            <RefreshCw :size="14" :class="{ 'animate-spin': skillsLoading }" />
            {{ skillsLoading ? t('settings.skills.refreshing') : t('common.refresh') }}
          </button>
          <button class="secondary-btn skills-btn" @click="() => openSkillsFolder()">
            {{ t('common.openFolder') }}
          </button>
        </div>
      </div>

      <p class="card-help">{{ t('settings.skills.description') }}</p>

      <div v-if="skillRoots.length" class="skills-paths">
        <div v-for="root in skillRoots" :key="root.source" class="skills-path-row">
          <span class="skills-path-label">
            {{ root.source === 'user' ? t('settings.skills.source.personal') : t('settings.skills.source.codex') }}
          </span>
          <code class="skills-path-value">{{ root.path }}</code>
          <button class="skills-mini-btn" @click="openSkillsFolder(root.source)">
            {{ t('common.open') }}
          </button>
        </div>
      </div>

      <div class="skills-search">
        <input
          v-model="skillSearchQuery"
          type="text"
          :placeholder="t('settings.skills.searchPlaceholder')"
        />
      </div>

      <p v-if="skillsError" class="skills-error">{{ skillsError }}</p>

      <div v-if="!skillsLoading && filteredSkills.length === 0" class="skills-empty">
        {{ t('settings.skills.empty') }}
      </div>

      <div v-else class="skills-groups">
        <div v-if="personalSkills.length" class="skills-group">
          <div class="skills-group-title">
            {{ t('settings.skills.group.personal') }}
            <span class="skills-count-pill">{{ personalSkills.length }}</span>
          </div>
          <div class="skills-list">
            <div v-for="skill in personalSkills" :key="skill.id" class="skill-item">
              <div class="skill-item-header">
                <div class="skill-item-meta">
                  <div class="skill-name">{{ skill.name }}</div>
                  <div class="skill-desc">{{ skill.description || t('settings.skills.noDescription') }}</div>
                  <div class="skill-id">{{ skill.path || skill.id }}</div>
                </div>
                <div class="skill-item-actions">
                  <button class="skills-mini-btn" @click="openSkillFolder(skill.id)">
                    {{ t('common.open') }}
                  </button>
                  <button class="skills-mini-btn" @click="toggleSkillContent(skill.id)">
                    {{ isSkillExpanded(skill.id) ? t('common.hide') : t('settings.skills.viewContent') }}
                  </button>
                </div>
              </div>
              <div v-if="isSkillExpanded(skill.id)" class="skill-content">
                <div v-if="skillContentLoading[skill.id]" class="skills-empty">{{ t('common.loading') }}</div>
                <pre v-else class="skill-content-pre">{{ skillContents[skill.id] || '' }}</pre>
                <div v-if="skillContentTruncated[skill.id]" class="skills-truncated">
                  {{ t('settings.skills.contentTruncated') }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="codexSkills.length" class="skills-group">
          <div class="skills-group-title">
            {{ t('settings.skills.group.codex') }}
            <span class="skills-count-pill">{{ codexSkills.length }}</span>
          </div>
          <div class="skills-list">
            <div v-for="skill in codexSkills" :key="skill.id" class="skill-item">
              <div class="skill-item-header">
                <div class="skill-item-meta">
                  <div class="skill-name">{{ skill.name }}</div>
                  <div class="skill-desc">{{ skill.description || t('settings.skills.noDescription') }}</div>
                  <div class="skill-id">{{ skill.path || skill.id }}</div>
                </div>
                <div class="skill-item-actions">
                  <button class="skills-mini-btn" @click="openSkillFolder(skill.id)">
                    {{ t('common.open') }}
                  </button>
                  <button class="skills-mini-btn" @click="toggleSkillContent(skill.id)">
                    {{ isSkillExpanded(skill.id) ? t('common.hide') : t('settings.skills.viewContent') }}
                  </button>
                </div>
              </div>
              <div v-if="isSkillExpanded(skill.id)" class="skill-content">
                <div v-if="skillContentLoading[skill.id]" class="skills-empty">{{ t('common.loading') }}</div>
                <pre v-else class="skill-content-pre">{{ skillContents[skill.id] || '' }}</pre>
                <div v-if="skillContentTruncated[skill.id]" class="skills-truncated">
                  {{ t('settings.skills.contentTruncated') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.skills.workflowTitle') }}</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.workflowOptimization.enabled"
          @change="
            updateWorkflowOptimization('enabled', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t('settings.skills.workflowEnable') }}
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.workflowOptimization.autoPinSkills"
          :disabled="!config.workflowOptimization.enabled"
          @change="
            updateWorkflowOptimization('autoPinSkills', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t('settings.skills.workflowAutoPin') }}
      </label>
      <p class="card-help">{{ t('settings.skills.workflowDescription') }}</p>
      <div class="skills-toolbar-actions">
        <button
          class="secondary-btn skills-btn"
          @click="resetWorkflowOptimization"
          :disabled="workflowResetting"
        >
          {{ workflowResetting ? t('settings.skills.workflowResetting') : t('settings.skills.workflowReset') }}
        </button>
      </div>
      <p v-if="workflowResetError" class="skills-error">{{ workflowResetError }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { RefreshCw } from 'lucide-vue-next';

import { useConfigStore } from '../../store/config';
import { useI18n } from '../../i18n';
import { getElectronApiSlice, getElectronApiSliceMethod } from '../../services/electron_api';
import type { AppConfig } from '@iki/core/types/config';
import type { SkillSummary } from '@iki/core/types/skill';
import { getErrorMessage } from '@iki/core/utils/errors';

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();
const { t } = useI18n();
const skillsApi = getElectronApiSlice('skills', ['list', 'roots', 'openRoot', 'openSkill', 'read']);
const resetAutoPinnedSkills = getElectronApiSliceMethod('workflow', 'resetAutoPinnedSkills');

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const skills = ref<SkillSummary[]>([]);
const skillsLoading = ref(false);
const skillsError = ref('');
const skillSearchQuery = ref('');
const skillRoots = ref<Array<{ source: 'user' | 'codex'; path: string }>>([]);
const expandedSkillIds = ref<string[]>([]);
const skillContents = ref<Record<string, string>>({});
const skillContentLoading = ref<Record<string, boolean>>({});
const skillContentTruncated = ref<Record<string, boolean>>({});
const workflowResetting = ref(false);
const workflowResetError = ref('');

const updateWorkflowOptimization = <K extends keyof AppConfig['workflowOptimization']>(
  key: K,
  value: AppConfig['workflowOptimization'][K]
) => {
  config.value.workflowOptimization[key] = value;
  emit('config-change');
};

const resetWorkflowOptimization = async () => {
  workflowResetError.value = '';
  if (!resetAutoPinnedSkills) {
    workflowResetError.value = t('settings.skills.error.resetUnavailable');
    return;
  }
  workflowResetting.value = true;
  try {
    const result = await resetAutoPinnedSkills();
    if (!result?.success) {
      workflowResetError.value =
        result?.error || t('settings.skills.error.resetFailed', { error: '' });
    }
  } catch (error: unknown) {
    workflowResetError.value = t('settings.skills.error.resetFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    workflowResetting.value = false;
  }
};

const loadSkillRoots = async () => {
  if (!skillsApi) {
    skillRoots.value = [];
    return;
  }
  try {
    const roots = await skillsApi.roots();
    skillRoots.value = Array.isArray(roots) ? roots : [];
  } catch {
    skillRoots.value = [];
  }
};

const refreshSkills = async () => {
  skillsLoading.value = true;
  skillsError.value = '';
  if (!skillsApi) {
    skills.value = [];
    skillsError.value = t('settings.skills.error.loadFailed', {
      error: t('common.unavailable'),
    });
    skillsLoading.value = false;
    return;
  }
  try {
    const list = await skillsApi.list();
    skills.value = Array.isArray(list) ? list : [];
  } catch (error: unknown) {
    skillsError.value = t('settings.skills.error.loadFailed', { error: getErrorMessage(error) });
    skills.value = [];
  } finally {
    skillsLoading.value = false;
  }
};

const openSkillsFolder = async (source?: 'user' | 'codex') => {
  if (!skillsApi) {
    skillsError.value = t('settings.skills.error.openFolderFailed', {
      error: t('common.unavailable'),
    });
    return;
  }
  try {
    const result = await skillsApi.openRoot(source);
    if (result?.success === false) {
      skillsError.value =
        result?.error || t('settings.skills.error.openFolderFailed', { error: '' });
    }
  } catch (error: unknown) {
    skillsError.value = t('settings.skills.error.openFolderFailed', {
      error: getErrorMessage(error),
    });
  }
};

const openSkillFolder = async (id: string) => {
  if (!skillsApi) {
    skillsError.value = t('settings.skills.error.openSkillFailed', {
      error: t('common.unavailable'),
    });
    return;
  }
  try {
    const result = await skillsApi.openSkill(id);
    if (result?.success === false) {
      skillsError.value = result?.error || t('settings.skills.error.openSkillFailed', { error: '' });
    }
  } catch (error: unknown) {
    skillsError.value = t('settings.skills.error.openSkillFailed', {
      error: getErrorMessage(error),
    });
  }
};

const isSkillExpanded = (id: string) => expandedSkillIds.value.includes(id);

const toggleSkillContent = async (id: string) => {
  const alreadyExpanded = isSkillExpanded(id);
  if (alreadyExpanded) {
    expandedSkillIds.value = expandedSkillIds.value.filter(existing => existing !== id);
    return;
  }

  expandedSkillIds.value = [...expandedSkillIds.value, id];

  if (typeof skillContents.value[id] === 'string') {
    return;
  }

  skillContentLoading.value = { ...skillContentLoading.value, [id]: true };
  if (!skillsApi) {
    skillsError.value = t('settings.skills.error.readFailed', {
      error: t('common.unavailable'),
    });
    skillContentLoading.value = { ...skillContentLoading.value, [id]: false };
    return;
  }
  try {
    const result = await skillsApi.read(id, { maxChars: 20000 });
    if (result?.success === false) {
      skillsError.value = result?.error || t('settings.skills.error.readFailed', { error: '' });
      skillContents.value = { ...skillContents.value, [id]: '' };
      skillContentTruncated.value = { ...skillContentTruncated.value, [id]: false };
      return;
    }
    skillContents.value = { ...skillContents.value, [id]: result?.content || '' };
    skillContentTruncated.value = {
      ...skillContentTruncated.value,
      [id]: Boolean(result?.truncated),
    };
  } catch (error: unknown) {
    skillsError.value = t('settings.skills.error.readFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    skillContentLoading.value = { ...skillContentLoading.value, [id]: false };
  }
};

const filteredSkills = computed(() => {
  const query = skillSearchQuery.value.trim().toLowerCase();
  if (!query) return skills.value;
  return skills.value.filter(skill => {
    const haystack = `${skill.name} ${skill.description} ${skill.id} ${skill.source}`.toLowerCase();
    return haystack.includes(query);
  });
});

const personalSkills = computed(() =>
  filteredSkills.value.filter(skill => skill.source === 'user')
);
const codexSkills = computed(() => filteredSkills.value.filter(skill => skill.source === 'codex'));

watch(
  () => props.active,
  active => {
    if (active) {
      void loadSkillRoots();
      void refreshSkills();
    }
  },
  { immediate: true }
);
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.skills-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}

.skills-toolbar-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skills-subtitle {
  color: var(--text-secondary);
  font-size: 0.92em;
}

.skills-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.skills-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
}

.skills-paths {
  margin: 10px 0 14px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

.skills-path-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.skills-path-row:first-child {
  border-top: none;
}

.skills-path-label {
  width: 70px;
  color: var(--text-secondary);
  font-size: 0.9em;
}

.skills-path-value {
  flex: 1;
  color: var(--text-primary);
  font-size: 0.85em;
  background: transparent;
  padding: 0;
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skills-search {
  margin-top: 8px;
  margin-bottom: 12px;
}

.skills-search input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size);
}

.skills-empty {
  color: var(--text-secondary);
  font-size: 0.95em;
  padding: 10px 2px;
}

.skills-error {
  color: var(--danger-color);
  font-size: 0.95em;
  margin: 10px 0 0;
}

.skills-groups {
  margin-top: 8px;
}

.skills-group {
  margin-top: 18px;
}

.skills-group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  margin-bottom: 10px;
}

.skills-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 22%, var(--border-color));
  color: var(--text-primary);
  font-size: 0.85em;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skill-item {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  padding: 14px;
}

.skill-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.skill-item-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.skill-name {
  font-weight: 600;
  color: var(--text-primary);
}

.skill-desc {
  color: var(--text-secondary);
  font-size: 0.93em;
  line-height: 1.35;
}

.skill-id {
  color: var(--text-secondary);
  font-size: 0.82em;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.skill-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.skills-mini-btn {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.skills-mini-btn:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}

.skill-content {
  margin-top: 12px;
}

.skill-content-pre {
  max-height: 320px;
  overflow: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  font-size: 0.88em;
  line-height: 1.35;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.skills-truncated {
  color: var(--text-secondary);
  font-size: 0.85em;
  margin-top: 8px;
}
</style>
