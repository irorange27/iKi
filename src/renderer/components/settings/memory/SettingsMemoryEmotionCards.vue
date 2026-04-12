<template>
  <div class="settings-card">
    <div class="card-title">{{ t('settings.memory.emotionTitle') }}</div>
    <label class="checkbox-label">
      <input
        type="checkbox"
        :checked="config.memory.emotion.enabled"
        @change="updateEmotion('enabled', ($event.target as HTMLInputElement).checked)"
      />
      {{ t('settings.memory.emotionEnable') }}
    </label>
    <p class="card-help">{{ t('settings.memory.emotionDescription') }}</p>

    <template v-if="config.memory.emotion.enabled">
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.injectToSystemPrompt"
          @change="
            updateEmotion('injectToSystemPrompt', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t('settings.memory.injectEmotionToAgent') }}
      </label>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.realtimeAnalysis"
          @change="updateEmotion('realtimeAnalysis', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.realtimeAnalysis') }}
      </label>
      <p class="card-help">{{ t('settings.memory.realtimeDescription') }}</p>

      <div class="slider-field">
        <span>{{ t('settings.memory.minimumConfidence') }}</span>
        <span class="value-badge">{{ Math.round(config.memory.emotion.minConfidence * 100) }}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="Math.round(config.memory.emotion.minConfidence * 100)"
        @input="
          updateEmotion('minConfidence', parseInt(($event.target as HTMLInputElement).value) / 100)
        "
      />
      <p class="slider-hint">{{ t('settings.memory.higherValuesConservative') }}</p>

      <div class="slider-field">
        <span>{{ t('settings.memory.minimumSamples') }}</span>
        <span class="value-badge">{{ config.memory.emotion.minSampleCount }}</span>
      </div>
      <input
        type="range"
        min="1"
        max="8"
        step="1"
        :value="config.memory.emotion.minSampleCount"
        @input="updateEmotion('minSampleCount', parseInt(($event.target as HTMLInputElement).value))"
      />

      <div class="slider-field">
        <span>{{ t('settings.memory.windowSize') }}</span>
        <span class="value-badge">{{ config.memory.emotion.windowSize }}</span>
      </div>
      <input
        type="range"
        min="1"
        max="20"
        step="1"
        :value="config.memory.emotion.windowSize"
        @input="updateEmotion('windowSize', parseInt(($event.target as HTMLInputElement).value))"
      />
      <p class="slider-hint">{{ t('settings.memory.windowSizeHint') }}</p>

      <label class="input-label">
        <span>{{ t('settings.memory.halfLifeMinutes') }}</span>
        <input
          type="number"
          min="5"
          max="720"
          :value="config.memory.emotion.halfLifeMinutes"
          @input="
            updateEmotion(
              'halfLifeMinutes',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>

      <label class="input-label">
        <span>{{ t('settings.memory.maxAgeMinutes') }}</span>
        <input
          type="number"
          min="10"
          max="1440"
          :value="config.memory.emotion.maxAgeMinutes"
          @input="
            updateEmotion(
              'maxAgeMinutes',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.includeNeutral"
          @change="updateEmotion('includeNeutral', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.includeNeutralSignals') }}
      </label>
    </template>
  </div>

  <div v-if="config.memory.emotion.enabled" class="settings-card">
    <div class="card-title">{{ t('settings.memory.toolGuardTitle') }}</div>
    <label class="checkbox-label">
      <input
        type="checkbox"
        :checked="config.memory.emotion.toolGuard.enabled"
        @change="updateEmotionGuard('enabled', ($event.target as HTMLInputElement).checked)"
      />
      {{ t('settings.memory.toolGuardEnable') }}
    </label>
    <p class="card-help">{{ t('settings.memory.toolGuardDescription') }}</p>

    <template v-if="config.memory.emotion.toolGuard.enabled">
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.toolGuard.requireApproval"
          @change="
            updateEmotionGuard('requireApproval', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t('settings.memory.toolGuardRequireApproval') }}
      </label>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.toolGuard.disableAutoTools"
          @change="
            updateEmotionGuard('disableAutoTools', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t('settings.memory.toolGuardDisableAuto') }}
      </label>

      <div class="slider-field">
        <span>{{ t('settings.memory.toolGuardConfidenceThreshold') }}</span>
        <span class="value-badge">
          {{ Math.round(config.memory.emotion.toolGuard.minConfidence * 100) }}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="Math.round(config.memory.emotion.toolGuard.minConfidence * 100)"
        @input="
          updateEmotionGuard(
            'minConfidence',
            parseInt(($event.target as HTMLInputElement).value) / 100
          )
        "
      />

      <div class="slider-field">
        <span>{{ t('settings.memory.toolGuardArousalThreshold') }}</span>
        <span class="value-badge">
          {{ Math.round(config.memory.emotion.toolGuard.minArousal * 100) }}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="Math.round(config.memory.emotion.toolGuard.minArousal * 100)"
        @input="
          updateEmotionGuard(
            'minArousal',
            parseInt(($event.target as HTMLInputElement).value) / 100
          )
        "
      />

      <div class="slider-field">
        <span>{{ t('settings.memory.toolGuardValenceThreshold') }}</span>
        <span class="value-badge">
          {{ Math.round(config.memory.emotion.toolGuard.maxValence * 100) }}%
        </span>
      </div>
      <input
        type="range"
        min="-100"
        max="0"
        step="1"
        :value="Math.round(config.memory.emotion.toolGuard.maxValence * 100)"
        @input="
          updateEmotionGuard(
            'maxValence',
            parseInt(($event.target as HTMLInputElement).value) / 100
          )
        "
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';

import { useI18n } from '../../../i18n';
import { useConfigStore } from '../../../store/config';
import type { AppConfig } from '../../../../shared/types/config';

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const updateEmotion = <K extends keyof AppConfig['memory']['emotion']>(
  key: K,
  value: AppConfig['memory']['emotion'][K]
) => {
  config.value.memory.emotion[key] = value;
  emit('config-change');
};

const updateEmotionGuard = <K extends keyof AppConfig['memory']['emotion']['toolGuard']>(
  key: K,
  value: AppConfig['memory']['emotion']['toolGuard'][K]
) => {
  config.value.memory.emotion.toolGuard[key] = value;
  emit('config-change');
};
</script>

<style scoped src="../settings_shared.css"></style>
