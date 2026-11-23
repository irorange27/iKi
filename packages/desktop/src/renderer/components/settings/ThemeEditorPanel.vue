<template>
  <div class="theme-inline-studio">
    <div class="theme-studio-header">
      <div>
        <div class="theme-studio-title">
          {{
            editor.editingPresetId
              ? t('settings.theme.modal.editTitle')
              : t('settings.theme.modal.createTitle')
          }}
        </div>
        <div class="theme-studio-subtitle">
          {{ t('settings.theme.modal.subtitle') }}
        </div>
      </div>
      <div class="theme-studio-header-actions">
        <button class="secondary-btn" type="button" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button class="primary-btn" type="button" @click="emit('save')">
          {{ t('common.save') }}
        </button>
      </div>
    </div>

    <div class="theme-studio-body">
      <div class="theme-editor-column">
        <div class="theme-editor-grid">
          <label class="input-label">
            <span>{{ t('settings.theme.modal.displayName') }}</span>
            <input
              :value="editor.label"
              type="text"
              :placeholder="t('settings.theme.modal.displayNamePlaceholder')"
              @input="handleLabelInput"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.theme.modal.type') }}</span>
            <SettingsSelect
              :model-value="editor.type"
              :options="themeVariantOptions"
              :aria-label="t('settings.theme.modal.typeAria')"
              @update:model-value="emit('set-editor-type', $event as ThemeVariant)"
            />
          </label>
        </div>

        <div class="editor-mode-toggle">
          <button
            type="button"
            class="editor-mode-btn"
            :class="{ active: editor.mode === 'simple' }"
            @click="emit('set-editor-mode', 'simple')"
          >
            <Sparkles :size="15" />
            {{ t('settings.theme.modal.simple') }}
          </button>
          <button
            type="button"
            class="editor-mode-btn"
            :class="{ active: editor.mode === 'advanced' }"
            @click="emit('set-editor-mode', 'advanced')"
          >
            <SlidersHorizontal :size="15" />
            {{ t('settings.theme.modal.advanced') }}
          </button>
        </div>

        <template v-if="editor.mode === 'simple'">
          <p class="editor-help">
            {{ t('settings.theme.modal.simpleHelp') }}
          </p>
          <div class="quick-start-row">
            <button
              v-for="preset in quickStarts"
              :key="preset.id"
              type="button"
              class="quick-start-chip"
              :class="{ active: editor.quickStartId === preset.id }"
              @click="emit('apply-quick-start', preset.id)"
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
              :label="t(field.labelKey)"
              :hint="t(field.hintKey)"
              :value="editor.simple[field.key]"
              @update:value="handleSimpleColorUpdate(field.key, $event)"
            />
          </div>
        </template>

        <template v-else>
          <p class="editor-help">
            {{ t('settings.theme.modal.advancedHelp') }}
          </p>
          <div class="theme-editor-grid advanced-grid">
            <ThemeColorField
              v-for="field in ADVANCED_THEME_FIELDS"
              :key="field.key"
              :label="t(field.labelKey)"
              :hint="t(field.hintKey)"
              :value="editor.advanced[field.key]"
              @update:value="handleAdvancedColorUpdate(field.key, $event)"
            />
          </div>
        </template>

        <p class="editor-footnote-copy">
          {{
            editor.mode === 'simple'
              ? t('settings.theme.modal.footnoteSimple')
              : t('settings.theme.modal.footnoteAdvanced')
          }}
        </p>

        <p v-if="editor.error" class="error-text">{{ editor.error }}</p>
      </div>

      <ThemePreview :label="editor.label" :preview-style="previewStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { SlidersHorizontal, Sparkles } from '@lucide/vue';

import ThemeColorField from './ThemeColorField.vue';
import ThemePreview from './ThemePreview.vue';
import SettingsSelect from './SettingsSelect.vue';
import { ADVANCED_THEME_FIELDS, SIMPLE_THEME_FIELDS } from './theme_editor_fields';
import { useI18n } from '../../i18n';
import type { ThemeEditorMode, ThemeEditorState } from '../../composables/useThemeEditor';
import type {
  AdvancedThemeSeed,
  SimpleThemeSeed,
  ThemeQuickStartDefinition,
  ThemeVariant,
} from '@iki/theme/types';

const props = defineProps<{
  editor: ThemeEditorState;
  previewStyle: Record<string, string>;
  quickStarts: ThemeQuickStartDefinition[];
  themeVariantOptions: Array<{ value: ThemeVariant; label: string }>;
}>();
const { t } = useI18n();

const emit = defineEmits<{
  close: [];
  save: [];
  'update-label': [value: string];
  'set-editor-mode': [value: ThemeEditorMode];
  'set-editor-type': [value: ThemeVariant];
  'apply-quick-start': [value: string];
  'update-simple-color': [payload: { key: keyof SimpleThemeSeed; value: string }];
  'update-advanced-color': [payload: { key: keyof AdvancedThemeSeed; value: string }];
}>();

const handleLabelInput = (event: Event) => {
  emit('update-label', (event.target as HTMLInputElement | null)?.value ?? '');
};

const getQuickStartSwatches = (preset: ThemeQuickStartDefinition): string[] => {
  const seed = props.editor.type === 'light' ? preset.light : preset.dark;
  return [seed.background, seed.accent, seed.secondary];
};

const handleSimpleColorUpdate = (key: keyof SimpleThemeSeed, value: string) => {
  emit('update-simple-color', { key, value });
};

const handleAdvancedColorUpdate = (key: keyof AdvancedThemeSeed, value: string) => {
  emit('update-advanced-color', { key, value });
};
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.theme-inline-studio {
  margin-top: 16px;
  padding: 20px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  background:
    radial-gradient(circle at top left, rgba(var(--accent-rgb), 0.06), transparent 36%),
    color-mix(in srgb, var(--bg-secondary) 86%, transparent);
}

.theme-studio-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
}

.theme-studio-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.theme-studio-subtitle {
  color: var(--text-secondary);
  font-size: 12px;
}

.theme-studio-header-actions {
  display: flex;
  flex: none;
  gap: 8px;
}

.theme-studio-body {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(300px, 420px);
  gap: 20px 24px;
  align-items: start;
}

.theme-editor-column {
  min-width: 0;
}

.theme-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.theme-editor-grid .input-label {
  padding: 6px 0;
  border-bottom: none;
}

.advanced-grid {
  margin-top: 8px;
}

.editor-footnote-copy {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 14px 0 0;
}

.editor-mode-toggle {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 5px;
  border-radius: 12px;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  margin: 10px 0 14px;
}

.editor-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.editor-mode-btn.active {
  background: var(--bg-active);
  color: var(--text-primary);
}

.editor-help {
  color: var(--text-secondary);
  margin: 0 0 12px;
  font-size: 12px;
}

.quick-start-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.quick-start-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 7px 11px;
  font-size: 12px;
  cursor: pointer;
}

.quick-start-chip.active {
  border-color: color-mix(in srgb, var(--accent-color) 55%, transparent);
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-primary));
}

.chip-swatches {
  display: inline-flex;
  gap: 4px;
}

.chip-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}

@media (max-width: 960px) {
  .theme-studio-body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .theme-editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
