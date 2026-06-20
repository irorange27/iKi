<template>
  <div class="settings-card">
    <div class="card-title">{{ t('settings.memory.contextTitle') }}</div>
    <label class="checkbox-label">
      <input
        type="checkbox"
        :checked="config.memory.context.enabled"
        @change="updateMemoryContext('enabled', ($event.target as HTMLInputElement).checked)"
      />
      {{ t('settings.memory.contextEnable') }}
    </label>
    <p class="card-help">{{ t('settings.memory.contextDescription') }}</p>

    <template v-if="config.memory.context.enabled">
      <label class="input-label">
        <span>{{ t('settings.memory.recentRawMessages') }}</span>
        <input
          type="number"
          min="2"
          max="20"
          :value="config.memory.context.recentMessageCount"
          @input="
            updateMemoryContext(
              'recentMessageCount',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
      <label class="input-label">
        <span>{{ t('settings.memory.recentHistoryBudget') }}</span>
        <input
          type="number"
          min="200"
          max="12000"
          step="100"
          :value="config.memory.context.maxRecentTokens"
          @input="
            updateMemoryContext(
              'maxRecentTokens',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
      <label class="input-label">
        <span>{{ t('settings.memory.summaryTriggerMessages') }}</span>
        <input
          type="number"
          min="4"
          max="100"
          :value="config.memory.context.summaryTriggerMessages"
          @input="
            updateMemoryContext(
              'summaryTriggerMessages',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
      <label class="input-label">
        <span>{{ t('settings.memory.recentExcludedFromSummary') }}</span>
        <input
          type="number"
          min="2"
          max="20"
          :value="config.memory.context.summaryRecentMessages"
          @input="
            updateMemoryContext(
              'summaryRecentMessages',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
      <label class="input-label">
        <span>{{ t('settings.memory.threadSummaryBudget') }}</span>
        <input
          type="number"
          min="100"
          max="4000"
          step="50"
          :value="config.memory.context.maxSummaryTokens"
          @input="
            updateMemoryContext(
              'maxSummaryTokens',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
      <label class="input-label">
        <span>{{ t('settings.memory.memoryBudget') }}</span>
        <input
          type="number"
          min="100"
          max="4000"
          step="50"
          :value="config.memory.context.maxMemoryTokens"
          @input="
            updateMemoryContext(
              'maxMemoryTokens',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
      <label class="input-label">
        <span>{{ t('settings.memory.skillBudget') }}</span>
        <input
          type="number"
          min="100"
          max="8000"
          step="50"
          :value="config.memory.context.maxSkillTokens"
          @input="
            updateMemoryContext(
              'maxSkillTokens',
              parseInt(($event.target as HTMLInputElement).value || '0')
            )
          "
        />
      </label>
    </template>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';

import { useI18n } from '../../../i18n';
import { useConfigStore } from '../../../store/config';
import type { AppConfig } from '@iki/backend/types/config';

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const updateMemoryContext = <K extends keyof AppConfig['memory']['context']>(
  key: K,
  value: AppConfig['memory']['context'][K]
) => {
  config.value.memory.context[key] = value;
  emit('config-change');
};
</script>

<style scoped src="../settings_shared.css"></style>
