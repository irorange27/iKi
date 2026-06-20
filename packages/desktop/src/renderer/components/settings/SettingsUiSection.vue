<template>
  <section class="config-section">
    <div class="config-group">
      <h3>
        {{ t('settings.ui.fontSize') }}
        <span class="value-badge">{{ config.ui.fontSize }}px</span>
      </h3>
      <input type="range" min="10" max="32" :value="config.ui.fontSize" @input="setFontSize" />
    </div>

    <div class="config-group">
      <h3>
        {{ t('settings.ui.chatContentPadding') }}
        <span class="value-badge">{{ config.ui.chatContentPadding }}px</span>
      </h3>
      <input
        type="range"
        min="8"
        max="40"
        :value="config.ui.chatContentPadding"
        @input="setUiMetric('chatContentPadding', $event)"
      />
    </div>

    <div class="config-group">
      <h3>
        {{ t('settings.ui.composerPadding') }}
        <span class="value-badge">{{ config.ui.composerPadding }}px</span>
      </h3>
      <input
        type="range"
        min="4"
        max="24"
        :value="config.ui.composerPadding"
        @input="setUiMetric('composerPadding', $event)"
      />
    </div>

    <div class="config-group">
      <h3>
        {{ t('settings.ui.bubbleHorizontalPadding') }}
        <span class="value-badge">{{ config.ui.messageBubblePaddingX }}px</span>
      </h3>
      <input
        type="range"
        min="8"
        max="28"
        :value="config.ui.messageBubblePaddingX"
        @input="setUiMetric('messageBubblePaddingX', $event)"
      />
    </div>

    <div class="config-group">
      <h3>
        {{ t('settings.ui.bubbleVerticalPadding') }}
        <span class="value-badge">{{ config.ui.messageBubblePaddingY }}px</span>
      </h3>
      <input
        type="range"
        min="6"
        max="20"
        :value="config.ui.messageBubblePaddingY"
        @input="setUiMetric('messageBubblePaddingY', $event)"
      />
    </div>

    <div class="config-group">
      <h3>
        {{ t('settings.ui.messageGap') }}
        <span class="value-badge">{{ config.ui.messageGap }}px</span>
      </h3>
      <input
        type="range"
        min="8"
        max="32"
        :value="config.ui.messageGap"
        @input="setUiMetric('messageGap', $event)"
      />
    </div>

    <div class="config-group">
      <h3>{{ t('settings.ui.interfaceDensity') }}</h3>
      <div class="density-options">
        <div
          v-for="density in densityOptions"
          :key="density.key"
          class="density-card"
          :class="{ active: config.ui.density === density.key }"
          @click="setDensity(density.key)"
        >
          <div class="density-preview" :data-density="density.key"></div>
          <span>{{ density.label }}</span>
        </div>
      </div>
    </div>

    <button class="reset-btn" @click="emit('reset')">{{ t('settings.ui.reset') }}</button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '@iki/backend/types/config';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
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
.density-options {
  display: flex;
  gap: 16px;
}

.density-card {
  flex: 1;
  padding: 16px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
}

.density-card.active {
  border-color: var(--accent-color);
}

.density-preview {
  height: 40px;
  background: var(--bg-secondary);
  border-radius: 4px;
  margin-bottom: 8px;
  position: relative;
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
