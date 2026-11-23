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
          :aria-label="t('a11y.searchSkills')"
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
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RefreshCw } from '@lucide/vue';

import { useI18n } from '../../i18n';
import { useSettingsClient } from '../../services/settings_client';
import type { SkillSummary } from '@iki/core/types/skill';
import { getErrorMessage } from '@iki/core/utils/errors';

const props = defineProps<{
  active: boolean;
}>();
const { t } = useI18n();
const settingsClient = useSettingsClient();
const skillsApi =
  settingsClient.skills.list &&
  settingsClient.skills.roots &&
  settingsClient.skills.openRoot &&
  settingsClient.skills.openSkill &&
  settingsClient.skills.read
    ? {
        list: settingsClient.skills.list,
        roots: settingsClient.skills.roots,
        openRoot: settingsClient.skills.openRoot,
        openSkill: settingsClient.skills.openSkill,
        read: settingsClient.skills.read,
      }
    : null;

const skills = ref<SkillSummary[]>([]);
const skillsLoading = ref(false);
const skillsError = ref('');
const skillSearchQuery = ref('');
const skillRoots = ref<Array<{ source: 'user' | 'codex'; path: string }>>([]);
const expandedSkillIds = ref<string[]>([]);
const skillContents = ref<Record<string, string>>({});
const skillContentLoading = ref<Record<string, boolean>>({});
const skillContentTruncated = ref<Record<string, boolean>>({});

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
  margin-bottom: 8px;
}

.skills-toolbar-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skills-subtitle {
  color: var(--text-muted);
  font-size: 12px;
}

.skills-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skills-btn {
  height: 28px;
  min-height: 28px;
}

.skills-paths {
  margin: 10px 0 12px;
  border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  border-radius: 10px;
  background: var(--bg-primary);
  overflow: hidden;
}

.skills-path-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 32%, transparent);
}

.skills-path-row:first-child {
  border-top: none;
}

.skills-path-label {
  width: 72px;
  flex: none;
  color: var(--text-muted);
  font-size: 12px;
}

.skills-path-value {
  flex: 1;
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  background: transparent;
  padding: 0;
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skills-search {
  margin: 10px 0 12px;
}

.skills-search input {
  width: 100%;
  height: 32px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 62%, transparent);
  border-radius: var(--control-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  box-sizing: border-box;
}

.skills-search input:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 18%, transparent);
}

.skills-empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 8px 0;
}

.skills-error {
  color: var(--danger-color);
  font-size: 12px;
  margin: 8px 0 0;
}

.skills-groups {
  margin-top: 8px;
}

.skills-group {
  margin-top: 16px;
}

.skills-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.skills-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 48%, transparent);
  color: var(--text-secondary);
  font-size: 11px;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-item {
  border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  border-radius: 10px;
  background: var(--bg-primary);
  padding: 12px 14px;
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
  gap: 4px;
  min-width: 0;
}

.skill-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.skill-desc {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.skill-id {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.skill-item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.skills-mini-btn {
  height: 26px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.skills-mini-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}

.skill-content {
  margin-top: 10px;
}

.skill-content-pre {
  max-height: 300px;
  overflow: auto;
  background: color-mix(in srgb, var(--bg-secondary) 65%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.skills-truncated {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 6px;
}
</style>
