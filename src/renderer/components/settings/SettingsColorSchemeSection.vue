<template>
  <section class="config-section color-scheme-section">
    <div class="settings-card mode-card">
      <div class="card-header">
        <div>
          <div class="card-title">Color Scheme</div>
          <div class="card-subtitle">
            Pick a theme preset, search the gallery, or design your own Base46-powered interface.
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
            {{ capitalizeWord(theme) }}
          </button>
        </div>
        <div class="mode-meta">
          <span class="mode-meta-label">Current preset</span>
          <span class="mode-meta-value">{{ selectedPresetLabel }}</span>
        </div>
      </div>

      <label class="search-shell">
        <Search :size="18" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search themes..."
          class="search-input"
        />
      </label>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title custom-title-row">
            <Palette :size="18" />
            <span>Custom Themes</span>
          </div>
          <div class="card-subtitle">
            Create, edit, and manage your own Base46-derived color schemes.
          </div>
        </div>
        <button class="primary-btn" @click="openCreateThemeModal()">
          <Plus :size="14" />
          Create Theme
        </button>
      </div>

      <div v-if="filteredCustomPresetCards.length === 0" class="custom-empty-state">
        <div class="custom-empty-message">
          {{
            customPresetSummaries.length === 0
              ? "No custom themes yet. Click 'Create Theme' to get started."
              : 'No custom themes match your search.'
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
            Built-in presets that resolve through the same semantic renderer token pipeline.
          </div>
        </div>
      </div>

      <div v-if="filteredBuiltinPresetCards.length === 0" class="custom-empty-state">
        <div class="custom-empty-message">No built-in themes match your search.</div>
      </div>

      <ThemePresetGrid
        v-else
        :presets="filteredBuiltinPresetCards"
        :selected-preset-id="currentThemePresetId"
        @select="selectThemePreset"
      />
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">Reset Color Scheme</button>
    </div>

    <div v-if="editor.open" class="theme-modal-backdrop" @click.self="closeEditor">
      <div class="theme-modal">
        <div class="theme-modal-header">
          <div>
            <div class="theme-modal-title">
              {{ editor.editingPresetId ? 'Edit Custom Theme' : 'Create Custom Theme' }}
            </div>
            <div class="theme-modal-subtitle">
              Design your own color scheme with guided Base46 controls and a live preview.
            </div>
          </div>
          <button class="secondary-btn mini-icon-btn" type="button" @click="closeEditor">×</button>
        </div>

        <div class="theme-modal-body">
          <div class="theme-editor-column">
            <div class="theme-editor-grid">
              <label class="input-label">
                <span>Display Name</span>
                <input v-model="editor.label" type="text" placeholder="Ocean" />
              </label>
              <label class="input-label">
                <span>Type</span>
                <SettingsSelect
                  :model-value="editor.type"
                  :options="themeVariantOptions"
                  aria-label="Theme variant"
                  @update:model-value="setEditorType($event as ThemeVariant)"
                />
              </label>
            </div>

            <div class="editor-mode-toggle">
              <button
                class="editor-mode-btn"
                :class="{ active: editor.mode === 'simple' }"
                @click="setEditorMode('simple')"
              >
                <Sparkles :size="16" />
                Simple
              </button>
              <button
                class="editor-mode-btn"
                :class="{ active: editor.mode === 'advanced' }"
                @click="setEditorMode('advanced')"
              >
                <SlidersHorizontal :size="16" />
                Advanced
              </button>
            </div>

            <template v-if="editor.mode === 'simple'">
              <p class="editor-help">
                Pick 4 colors and iKi will generate a complete theme for you.
              </p>
              <div class="quick-start-row">
                <button
                  v-for="preset in quickStarts"
                  :key="preset.id"
                  class="quick-start-chip"
                  :class="{ active: editor.quickStartId === preset.id }"
                  @click="applyQuickStart(preset.id)"
                >
                  <span class="chip-swatches">
                    <span
                      v-for="(swatch, index) in getQuickStartSwatches(preset)"
                      :key="`${preset.id}-${index}`"
                      class="chip-swatch"
                      :style="{ backgroundColor: swatch }"
                    />
                  </span>
                  {{ preset.label }}
                </button>
              </div>
              <div class="theme-editor-grid">
                <ThemeColorField
                  v-for="field in SIMPLE_THEME_FIELDS"
                  :key="field.key"
                  :label="field.label"
                  :hint="field.hint"
                  :value="editor.simple[field.key]"
                  @update:value="updateSimpleColor(field.key, $event)"
                />
              </div>
            </template>

            <template v-else>
              <p class="editor-help">
                Fine-tune the core palette and iKi will derive the remaining Base46 fields.
              </p>
              <div class="theme-editor-grid advanced-grid">
                <ThemeColorField
                  v-for="field in ADVANCED_THEME_FIELDS"
                  :key="field.key"
                  :label="field.label"
                  :hint="field.hint"
                  :value="editor.advanced[field.key]"
                  @update:value="updateAdvancedColor(field.key, $event)"
                />
              </div>
            </template>

            <div class="editor-footnote">
              <div class="editor-footnote-divider" />
              <p class="editor-footnote-copy">
                {{
                  editor.mode === 'simple'
                    ? 'Switch to Advanced mode to fine-tune individual colors.'
                    : 'Advanced mode edits the core palette while iKi derives the remaining Base46 fields for consistency.'
                }}
              </p>
            </div>

            <p v-if="editor.error" class="error-text">{{ editor.error }}</p>
          </div>

          <div class="preview-column">
            <div class="preview-title">Preview</div>
            <div class="preview-shell" :style="previewStyle">
              <div class="preview-window-bar">
                <div class="preview-dots">
                  <span class="preview-dot dot-red" />
                  <span class="preview-dot dot-yellow" />
                  <span class="preview-dot dot-green" />
                </div>
                <div class="preview-window-name">{{ editor.label || 'Untitled Theme' }}</div>
              </div>
              <div class="preview-body">
                <div class="preview-sidebar">
                  <div class="preview-sidebar-item active">Selected Item</div>
                  <div class="preview-sidebar-item">Menu Item 1</div>
                  <div class="preview-sidebar-item">Menu Item 2</div>
                </div>
                <div class="preview-main">
                  <div class="preview-card">
                    <div class="preview-card-title">Card Title</div>
                    <div class="preview-card-copy">This is muted text content.</div>
                  </div>
                  <div class="preview-actions">
                    <button class="preview-primary-btn">Primary</button>
                    <button class="preview-secondary-btn">Secondary</button>
                    <button class="preview-tertiary-btn">Delete</button>
                  </div>
                  <div class="preview-code">
                    <span class="code-keyword">const</span>
                    <span class="code-variable">message</span>
                    <span class="code-operator">=</span>
                    <span class="code-string">"Hello"</span>
                    <span class="code-punctuation">;</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="theme-modal-footer">
          <button class="secondary-btn" @click="closeEditor">Cancel</button>
          <button class="primary-btn" @click="saveTheme">Save</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  MonitorCog,
  Moon,
  Palette,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import ThemePresetGrid from './ThemePresetGrid.vue';
import ThemeColorField from './ThemeColorField.vue';
import { ADVANCED_THEME_FIELDS, SIMPLE_THEME_FIELDS } from './theme_editor_fields';
import { useThemeEditor } from '../../composables/useThemeEditor';
import { useThemePresetGallery } from '../../composables/useThemePresetGallery';
import { useConfigStore } from '../../store/config';
import type { ThemeVariant } from '../../../shared/theme/types';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const systemPrefersDark = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const {
  capitalizeWord,
  customPresetSummaries,
  currentThemePresetId,
  filteredBuiltinPresetCards,
  filteredCustomPresetCards,
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

const getQuickStartSwatches = (preset: (typeof quickStarts)[number]): string[] => {
  const seed = editor.type === 'light' ? preset.light : preset.dark;
  return [seed.background, seed.accent, seed.secondary];
};

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

.theme-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(8, 10, 18, 0.24);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 56px 28px 28px;
}

.theme-modal {
  width: min(1340px, calc(100vw - 56px));
  max-height: 100%;
  overflow: hidden;
  border-radius: 30px;
  border: 1px solid color-mix(in srgb, var(--border-color) 92%, transparent);
  background:
    radial-gradient(circle at top left, rgba(var(--accent-rgb), 0.08), transparent 34%),
    color-mix(in srgb, var(--bg-primary) 98%, transparent);
  box-shadow: var(--surface-shadow-lg);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.theme-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 28px 30px 20px;
}

.theme-modal-title {
  font-size: 1.9em;
  font-weight: 700;
  margin-bottom: 8px;
}

.theme-modal-subtitle {
  color: var(--text-secondary);
  font-size: 1.02em;
}

.mini-icon-btn {
  width: 36px;
  min-width: 36px;
  height: 36px;
  padding: 0;
  font-size: 22px;
  line-height: 1;
}

.theme-modal-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 430px);
  gap: 28px;
  align-items: start;
  min-height: 0;
  overflow: auto;
  padding: 0 30px 10px;
}

.theme-editor-column {
  min-width: 0;
}

.theme-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 18px;
}

.advanced-grid {
  margin-top: 8px;
}

.editor-footnote {
  margin-top: 20px;
}

.editor-footnote-divider {
  height: 1px;
  background: color-mix(in srgb, var(--border-color) 92%, transparent);
  margin-bottom: 16px;
}

.editor-footnote-copy {
  color: var(--text-secondary);
  font-size: 0.98em;
  margin: 0;
}

.editor-mode-toggle {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
  border-radius: 22px;
  background: color-mix(in srgb, var(--bg-secondary) 84%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  margin: 8px 0 18px;
}

.editor-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: var(--text-secondary);
  padding: 14px 16px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.editor-mode-btn.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: var(--surface-shadow-md);
}

.editor-help {
  color: var(--text-secondary);
  margin: 0 0 18px;
  font-size: 1em;
}

.quick-start-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}

.quick-start-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-secondary) 84%, transparent);
  color: var(--text-primary);
  padding: 10px 14px;
  cursor: pointer;
}

.quick-start-chip.active {
  border-color: color-mix(in srgb, var(--accent-color) 48%, transparent);
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
}

.chip-swatches {
  display: inline-flex;
  gap: 6px;
}

.chip-swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}

.preview-column {
  position: sticky;
  top: 0;
  width: 100%;
  max-width: 430px;
  align-self: start;
  justify-self: end;
}

.preview-title {
  font-size: 1.05em;
  font-weight: 700;
  margin-bottom: 12px;
}

.preview-shell {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 26px;
  overflow: hidden;
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: var(--surface-shadow-lg);
}

.preview-window-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 95%, transparent);
}

.preview-dots {
  display: flex;
  gap: 8px;
}

.preview-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.dot-red {
  background: var(--danger-color);
}

.dot-yellow {
  background: var(--warning-color);
}

.dot-green {
  background: var(--success-color);
}

.preview-window-name {
  font-size: 1.15em;
  font-weight: 700;
}

.preview-body {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  min-height: 332px;
}

.preview-sidebar {
  border-right: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  padding: 14px 12px;
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
}

.preview-sidebar-item {
  color: var(--text-primary);
  padding: 10px 12px;
  border-radius: 12px;
  margin-bottom: 8px;
  font-size: 0.98em;
}

.preview-sidebar-item.active {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-hover));
  font-weight: 600;
}

.preview-main {
  padding: 18px 18px 20px;
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
}

.preview-card {
  padding: 18px 20px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-tertiary) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  margin-bottom: 18px;
}

.preview-card-title {
  font-size: 1.45em;
  font-weight: 700;
  margin-bottom: 8px;
}

.preview-card-copy {
  color: var(--text-secondary);
  font-size: 1.02em;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.preview-primary-btn,
.preview-secondary-btn,
.preview-tertiary-btn {
  border: none;
  border-radius: 12px;
  padding: 10px 16px;
  font-size: 0.98em;
  cursor: default;
}

.preview-primary-btn {
  background: color-mix(in srgb, var(--accent-color) 84%, white 16%);
  color: var(--accent-contrast);
}

.preview-secondary-btn {
  background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
  color: var(--text-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
}

.preview-tertiary-btn {
  background: color-mix(in srgb, var(--accent-color) 48%, var(--success-color) 52%);
  color: color-mix(in srgb, var(--text-primary) 88%, var(--bg-primary));
}

.preview-code {
  padding: 16px 18px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-primary) 84%, transparent);
  color: var(--text-primary);
  font-family: 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace;
  font-size: 0.95em;
}

.code-keyword {
  color: color-mix(in srgb, var(--success-color) 84%, white 16%);
}

.code-variable {
  color: color-mix(in srgb, var(--accent-color) 82%, white 18%);
  margin-left: 8px;
}

.code-operator {
  color: var(--text-secondary);
  margin: 0 8px;
}

.code-string {
  color: color-mix(in srgb, var(--warning-color) 74%, white 26%);
}

.code-punctuation {
  color: var(--text-secondary);
}

.theme-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 18px 30px 24px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 96%, transparent);
}

@media (max-width: 940px) {
  .theme-modal-body {
    grid-template-columns: 1fr;
  }

  .preview-column {
    position: static;
    max-width: none;
    justify-self: stretch;
  }
}

@media (max-width: 780px) {
  .theme-modal-backdrop {
    padding: 40px 16px 16px;
  }

  .theme-modal {
    width: calc(100vw - 32px);
    max-height: 100%;
  }

  .theme-modal-header,
  .theme-modal-body,
  .theme-modal-footer {
    padding-left: 20px;
    padding-right: 20px;
  }

  .theme-editor-grid,
  .preview-body {
    grid-template-columns: 1fr;
  }

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
