<template>
  <section class="config-section color-scheme-section">
    <div class="settings-card mode-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ t('settings.theme.title') }}</div>
          <div class="card-subtitle">
            {{ t('settings.theme.description') }}
          </div>
        </div>
      </div>

      <div class="mode-toolbar">
        <div class="mode-segment">
          <button
            v-for="theme in themeOptions"
            :key="theme"
            class="mode-pill"
            :class="{ active: config.general.theme === theme }"
            @click="setThemeMode(theme)"
          >
            <Moon v-if="theme === 'dark'" :size="14" />
            <Sun v-else-if="theme === 'light'" :size="14" />
            <MonitorCog v-else :size="14" />
            {{ formatThemeModeLabel(theme) }}
          </button>
        </div>
        <div class="mode-meta">
          <span class="mode-meta-label">{{ t('settings.theme.currentPreset') }}</span>
          <span class="mode-meta-value">{{ selectedPresetLabel }}</span>
        </div>
      </div>

      <label class="search-shell">
        <Search :size="18" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('settings.theme.searchPlaceholder')"
          class="search-input"
        />
      </label>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title custom-title-row">
            <Palette :size="18" />
            <span>{{ t('settings.theme.customTitle') }}</span>
          </div>
          <div class="card-subtitle">
            {{ t('settings.theme.customDescription') }}
          </div>
        </div>
        <button class="primary-btn" @click="openCreateThemeModal()">
          <Plus :size="14" />
          {{ t('settings.theme.create') }}
        </button>
      </div>

      <div v-if="filteredCustomPresetCards.length === 0" class="custom-empty-state">
        <div class="custom-empty-message">
          {{
            customPresetSummaries.length === 0
              ? t('settings.theme.emptyCustomInitial')
              : t('settings.theme.emptyCustomSearch')
          }}
        </div>
      </div>

      <ThemePresetGrid
        v-else
        kind="custom"
        :presets="filteredCustomPresetCards"
        :selected-preset-id="currentThemePresetId"
        @delete="deleteCustomTheme"
        @edit="openEditThemeModal"
        @select="selectThemePreset"
      />
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ gallerySectionTitle }}</div>
          <div class="card-subtitle">
            {{ t('settings.theme.builtinDescription') }}
          </div>
        </div>
      </div>

      <div v-if="filteredBuiltinPresetCards.length === 0" class="custom-empty-state">
        <div class="custom-empty-message">{{ t('settings.theme.emptyBuiltinSearch') }}</div>
      </div>

      <ThemePresetGrid
        v-else
        :presets="filteredBuiltinPresetCards"
        :selected-preset-id="currentThemePresetId"
        @select="selectThemePreset"
      />
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.theme.reset') }}
      </button>
    </div>

    <ThemeEditorModal
      v-if="editor.open"
      :editor="editor"
      :preview-style="previewStyle"
      :quick-starts="quickStarts"
      :theme-variant-options="themeVariantOptions"
      @apply-quick-start="applyQuickStart"
      @close="closeEditor"
      @save="saveTheme"
      @set-editor-mode="setEditorMode"
      @set-editor-type="setEditorType"
      @update-advanced-color="updateAdvancedColor($event.key, $event.value)"
      @update-label="editor.label = $event"
      @update-simple-color="updateSimpleColor($event.key, $event.value)"
    />
  </section>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import { MonitorCog, Moon, Palette, Plus, Search, Sun } from 'lucide-vue-next';

import ThemeEditorModal from './ThemeEditorModal.vue';
import ThemePresetGrid from './ThemePresetGrid.vue';
import { useThemeEditor } from '../../composables/useThemeEditor';
import { useThemePresetGallery } from '../../composables/useThemePresetGallery';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();
const { t } = useI18n();

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const systemPrefersDark = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const {
  customPresetSummaries,
  currentThemePresetId,
  filteredBuiltinPresetCards,
  filteredCustomPresetCards,
  formatThemeModeLabel,
  gallerySectionTitle,
  searchQuery,
  selectedPresetLabel,
  setThemeMode,
  selectThemePreset,
  themeOptions,
  themePresetSummaries,
} = useThemePresetGallery({
  config,
  onConfigChange: () => emit('config-change'),
  systemPrefersDark,
});

const {
  applyQuickStart,
  closeEditor,
  deleteCustomTheme,
  editor,
  openCreateThemeModal,
  openEditThemeModal,
  previewStyle,
  quickStarts,
  saveTheme,
  setEditorMode,
  setEditorType,
  themeVariantOptions,
  updateAdvancedColor,
  updateSimpleColor,
} = useThemeEditor({
  config,
  themePresetSummaries,
  onConfigChange: () => emit('config-change'),
});

watch(
  () => props.active,
  active => {
    if (active && !editor.open) {
      searchQuery.value = '';
    }
  }
);
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.color-scheme-section {
  max-width: 1180px;
}

.mode-card {
  padding-bottom: 18px;
}

.mode-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.mode-segment {
  display: inline-flex;
  gap: 8px;
  padding: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary) 76%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
}

.mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 10px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.mode-pill.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: var(--surface-shadow-md);
}

.mode-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
}

.mode-meta-label {
  color: var(--text-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.mode-meta-value {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.search-shell {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  color: var(--text-secondary);
}

.search-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 1.05em;
}

.search-input:focus {
  outline: none;
}

.custom-title-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.custom-empty-state {
  border: 1px dashed color-mix(in srgb, var(--border-color) 78%, transparent);
  border-radius: calc(var(--surface-radius) - 4px);
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at top left, rgba(var(--accent-rgb), 0.06), transparent 42%),
    color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}

.custom-empty-message {
  color: var(--text-secondary);
  font-size: 1.05em;
}

@media (max-width: 780px) {
  .mode-toolbar {
    align-items: flex-start;
  }

  .mode-segment {
    width: 100%;
    flex-wrap: wrap;
  }

  .mode-pill {
    flex: 1 1 120px;
    justify-content: center;
  }
}
</style>
