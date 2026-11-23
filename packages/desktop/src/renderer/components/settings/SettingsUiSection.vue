<template>
  <section class="config-section">
    <div class="config-group">
      <div class="ui-sliders-grid">
        <div class="ui-slider-item">
          <div class="ui-slider-head">
            <span>{{ t('settings.ui.fontSize') }}</span>
            <span class="value-badge">{{ config.ui.fontSize }}px</span>
          </div>
          <input
            type="range"
            min="10"
            max="32"
            :value="config.ui.fontSize"
            :aria-label="t('settings.ui.fontSize')"
            @input="setFontSize"
          />
        </div>

        <div class="ui-slider-item">
          <div class="ui-slider-head">
            <span>{{ t('settings.ui.chatContentPadding') }}</span>
            <span class="value-badge">{{ config.ui.chatContentPadding }}px</span>
          </div>
          <input
            type="range"
            min="8"
            max="40"
            :value="config.ui.chatContentPadding"
            :aria-label="t('settings.ui.chatContentPadding')"
            @input="setUiMetric('chatContentPadding', $event)"
          />
        </div>

        <div class="ui-slider-item">
          <div class="ui-slider-head">
            <span>{{ t('settings.ui.composerPadding') }}</span>
            <span class="value-badge">{{ config.ui.composerPadding }}px</span>
          </div>
          <input
            type="range"
            min="4"
            max="24"
            :value="config.ui.composerPadding"
            :aria-label="t('settings.ui.composerPadding')"
            @input="setUiMetric('composerPadding', $event)"
          />
        </div>

        <div class="ui-slider-item">
          <div class="ui-slider-head">
            <span>{{ t('settings.ui.bubbleHorizontalPadding') }}</span>
            <span class="value-badge">{{ config.ui.messageBubblePaddingX }}px</span>
          </div>
          <input
            type="range"
            min="8"
            max="28"
            :value="config.ui.messageBubblePaddingX"
            :aria-label="t('settings.ui.bubbleHorizontalPadding')"
            @input="setUiMetric('messageBubblePaddingX', $event)"
          />
        </div>

        <div class="ui-slider-item">
          <div class="ui-slider-head">
            <span>{{ t('settings.ui.bubbleVerticalPadding') }}</span>
            <span class="value-badge">{{ config.ui.messageBubblePaddingY }}px</span>
          </div>
          <input
            type="range"
            min="6"
            max="20"
            :value="config.ui.messageBubblePaddingY"
            :aria-label="t('settings.ui.bubbleVerticalPadding')"
            @input="setUiMetric('messageBubblePaddingY', $event)"
          />
        </div>

        <div class="ui-slider-item">
          <div class="ui-slider-head">
            <span>{{ t('settings.ui.messageGap') }}</span>
            <span class="value-badge">{{ config.ui.messageGap }}px</span>
          </div>
          <input
            type="range"
            min="8"
            max="32"
            :value="config.ui.messageGap"
            :aria-label="t('settings.ui.messageGap')"
            @input="setUiMetric('messageGap', $event)"
          />
        </div>
      </div>
    </div>

    <div class="config-group">
      <h3>{{ t('settings.ui.interfaceDensity') }}</h3>
      <div
        class="density-options"
        role="radiogroup"
        :aria-label="t('settings.ui.interfaceDensity')"
      >
        <div
          v-for="density in densityOptions"
          :key="density.key"
          class="density-card"
          :class="{ active: config.ui.density === density.key }"
          role="radio"
          :aria-checked="config.ui.density === density.key"
          tabindex="0"
          :aria-label="t('a11y.densityOption', { name: density.label })"
          @click="setDensity(density.key)"
          @keydown.enter.prevent="setDensity(density.key)"
          @keydown.space.prevent="setDensity(density.key)"
          @keydown.right.prevent="setDensityByOffset(density.key, 1, $event)"
          @keydown.down.prevent="setDensityByOffset(density.key, 1, $event)"
          @keydown.left.prevent="setDensityByOffset(density.key, -1, $event)"
          @keydown.up.prevent="setDensityByOffset(density.key, -1, $event)"
        >
          <div class="density-preview" :data-density="density.key"></div>
          <span class="density-label">{{ density.label }}</span>
        </div>
      </div>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.ui.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '@iki/core/types/config';

const emit = defineEmits<{
  'config-change': [];
  reset: [];
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const densityOptions = computed(() => [
  { key: 'compact' as const, label: t('settings.ui.compact') },
  { key: 'comfortable' as const, label: t('settings.ui.comfortable') },
  { key: 'spacious' as const, label: t('settings.ui.spacious') },
]);

const getRangeValue = (event: Event): number =>
  Number.parseInt((event.target as HTMLInputElement | null)?.value || '0', 10);

const updateUi = <K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) => {
  configStore.updateUi(key, value);
  emit('config-change');
};

const setFontSize = (event: Event) => {
  updateUi('fontSize', getRangeValue(event));
};

const setDensity = (density: AppConfig['ui']['density']) => {
  updateUi('density', density);
};

const setDensityByOffset = (current: AppConfig['ui']['density'], offset: number, event: Event) => {
  const keys = densityOptions.value.map(option => option.key);
  const index = keys.indexOf(current);
  if (index === -1) return;

  const nextIndex = (index + offset + keys.length) % keys.length;
  setDensity(keys[nextIndex]);

  const cards = (event.currentTarget as HTMLElement | null)?.parentElement?.children;
  const nextCard = cards?.[nextIndex];
  if (nextCard instanceof HTMLElement) nextCard.focus();
};
const setUiMetric = (
  key:
    | 'chatContentPadding'
    | 'composerPadding'
    | 'messageBubblePaddingX'
    | 'messageBubblePaddingY'
    | 'messageGap',
  event: Event
) => {
  updateUi(key, getRangeValue(event));
};
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.ui-sliders-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 20px;
}

.ui-slider-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ui-slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.density-options {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.density-card {
  flex: 1;
  padding: 12px;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 52%, transparent);
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.density-card:hover {
  border-color: color-mix(in srgb, var(--accent-color) 50%, var(--border-color));
}

.density-card.active {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 35%, transparent);
}

.density-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.density-preview {
  height: 36px;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-bottom: 8px;
  position: relative;
}

@media (max-width: 680px) {
  .ui-sliders-grid,
  .density-options {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}

.density-preview::before,
.density-preview::after {
  content: '';
  position: absolute;
  background: var(--border-color);
  border-radius: 2px;
}

.density-preview[data-density='compact']::before {
  top: 6px;
  left: 6px;
  right: 6px;
  height: 4px;
}

.density-preview[data-density='compact']::after {
  bottom: 6px;
  left: 6px;
  right: 6px;
  height: 4px;
}

.density-preview[data-density='comfortable']::before {
  top: 8px;
  left: 8px;
  right: 8px;
  height: 6px;
}

.density-preview[data-density='comfortable']::after {
  bottom: 8px;
  left: 8px;
  right: 8px;
  height: 6px;
}

.density-preview[data-density='spacious']::before {
  top: 12px;
  left: 12px;
  right: 12px;
  height: 8px;
}

.density-preview[data-density='spacious']::after {
  bottom: 12px;
  left: 12px;
  right: 12px;
  height: 8px;
}
</style>
