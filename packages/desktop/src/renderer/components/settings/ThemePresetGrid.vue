<template>
  <div class="preset-grid">
    <button
      v-for="preset in presets"
      :key="preset.id"
      class="preset-card"
      :class="{
        selected: selectedPresetId === preset.id,
        'custom-card': kind === 'custom',
      }"
      type="button"
      @click="emit('select', preset.id)"
    >
      <div class="preset-card-top">
        <div class="preset-swatches">
          <span
            v-for="(swatch, index) in preset.swatches"
            :key="`${preset.id}-${index}`"
            class="preset-swatch"
            :style="{ backgroundColor: swatch }"
          />
        </div>
        <div v-if="kind === 'custom'" class="preset-badges">
          <span class="preset-badge">{{ t('settings.theme.badge.custom') }}</span>
          <Check v-if="selectedPresetId === preset.id" :size="16" class="preset-check" />
        </div>
        <Check v-else-if="selectedPresetId === preset.id" :size="18" class="preset-check" />
      </div>

      <div class="preset-card-title">{{ preset.label }}</div>
      <div class="preset-card-meta">{{ formatVariantMeta(preset.variants) }}</div>

      <div v-if="kind === 'custom'" class="preset-card-actions">
        <button
          class="secondary-btn mini-btn"
          type="button"
          @click.stop="emit('edit', preset.id)"
        >
          <Pencil :size="14" />
          {{ t('settings.theme.action.edit') }}
        </button>
        <button
          class="danger-btn mini-btn"
          type="button"
          @click.stop="emit('delete', preset.id)"
        >
          <Trash2 :size="14" />
          {{ t('settings.theme.action.delete') }}
        </button>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Check, Pencil, Trash2 } from 'lucide-vue-next';

import { useI18n } from '../../i18n';
import type { ThemeVariant } from '@iki/core/theme/types';

type ThemePresetCard = {
  id: string;
  label: string;
  variants: ThemeVariant[];
  swatches: string[];
};

withDefaults(
  defineProps<{
    kind?: 'builtin' | 'custom';
    presets: ThemePresetCard[];
    selectedPresetId: string;
  }>(),
  {
    kind: 'builtin',
  }
);

const emit = defineEmits<{
  (event: 'delete', presetId: string): void;
  (event: 'edit', presetId: string): void;
  (event: 'select', presetId: string): void;
}>();

const { t } = useI18n();

const formatVariantLabel = (variant: ThemeVariant): string => {
  if (variant === 'light') return t('common.light');
  return t('common.dark');
};

const formatVariantMeta = (variants: ThemeVariant[]): string =>
  variants.length === 2
    ? t('settings.theme.meta.bothVariants')
    : t('settings.theme.meta.onlyVariant', {
        variant: formatVariantLabel(variants[0] || 'dark'),
      });
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.preset-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 18px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-primary) 96%, transparent) 0%,
    var(--bg-primary) 100%
  );
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.preset-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  box-shadow: var(--surface-shadow-md);
}

.preset-card.selected {
  border-color: var(--accent-color);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-color) 32%, transparent),
    0 18px 30px rgba(var(--accent-rgb), 0.15);
}

.preset-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.preset-swatches {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  box-shadow: var(--surface-inset-highlight);
}

.preset-check {
  color: var(--accent-color);
}

.preset-badges {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.preset-badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 600;
}

.preset-card-title {
  font-size: 1.02em;
  font-weight: 600;
}

.preset-card-meta {
  color: var(--text-secondary);
  font-size: 0.9em;
}

.preset-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mini-btn {
  min-height: 32px;
  padding: 7px 12px;
  font-size: 13px;
}
</style>
