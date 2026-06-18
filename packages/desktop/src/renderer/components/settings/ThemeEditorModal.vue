<template>
  <div class="theme-modal-backdrop" @click.self="emit('close')">
    <div class="theme-modal">
      <div class="theme-modal-header">
        <div>
          <div class="theme-modal-title">
            {{
              editor.editingPresetId
                ? t('settings.theme.modal.editTitle')
                : t('settings.theme.modal.createTitle')
            }}
          </div>
          <div class="theme-modal-subtitle">
            {{ t('settings.theme.modal.subtitle') }}
          </div>
        </div>
        <button class="secondary-btn mini-icon-btn" type="button" @click="emit('close')">×</button>
      </div>

      <div class="theme-modal-body">
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
              <Sparkles :size="16" />
              {{ t('settings.theme.modal.simple') }}
            </button>
            <button
              type="button"
              class="editor-mode-btn"
              :class="{ active: editor.mode === 'advanced' }"
              @click="emit('set-editor-mode', 'advanced')"
            >
              <SlidersHorizontal :size="16" />
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

          <div class="editor-footnote">
            <div class="editor-footnote-divider" />
            <p class="editor-footnote-copy">
              {{
                editor.mode === 'simple'
                  ? t('settings.theme.modal.footnoteSimple')
                  : t('settings.theme.modal.footnoteAdvanced')
              }}
            </p>
          </div>

          <p v-if="editor.error" class="error-text">{{ editor.error }}</p>
        </div>

        <ThemePreview :label="editor.label" :preview-style="previewStyle" />
      </div>

      <div class="theme-modal-footer">
        <button class="secondary-btn" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="primary-btn" @click="emit('save')">{{ t('common.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SlidersHorizontal, Sparkles } from 'lucide-vue-next';

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
} from '@iki/core/theme/types';

const props = defineProps<{
  editor: ThemeEditorState;
  previewStyle: Record<string, string>;
  quickStarts: ThemeQuickStartDefinition[];
  themeVariantOptions: Array<{ value: ThemeVariant; label: string }>;
}>();
const { t } = useI18n();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'save'): void;
  (event: 'update-label', value: string): void;
  (event: 'set-editor-mode', value: ThemeEditorMode): void;
  (event: 'set-editor-type', value: ThemeVariant): void;
  (event: 'apply-quick-start', value: string): void;
  (event: 'update-simple-color', payload: { key: keyof SimpleThemeSeed; value: string }): void;
  (event: 'update-advanced-color', payload: { key: keyof AdvancedThemeSeed; value: string }): void;
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
  width: min(1380px, calc(100vw - 40px));
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
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, 500px);
  gap: 24px 32px;
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

.theme-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 18px 30px 24px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 96%, transparent);
}

@media (max-width: 1120px) {
  .theme-modal-body {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
    gap: 22px 24px;
  }
}

@media (max-width: 860px) {
  .theme-modal-body {
    grid-template-columns: 1fr;
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

  .theme-editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
