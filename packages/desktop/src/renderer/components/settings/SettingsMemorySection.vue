<template>
  <section class="config-section">
    <SettingsMemoryRetrievalCards
      :providers="providers"
      @config-change="emit('config-change')"
    />
    <SettingsMemoryContextCard @config-change="emit('config-change')" />
    <SettingsMemoryEmotionCards @config-change="emit('config-change')" />
    <SettingsMemoryViewerCard :active="active" />

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.memory.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import SettingsMemoryContextCard from './memory/SettingsMemoryContextCard.vue';
import SettingsMemoryEmotionCards from './memory/SettingsMemoryEmotionCards.vue';
import SettingsMemoryRetrievalCards from './memory/SettingsMemoryRetrievalCards.vue';
import SettingsMemoryViewerCard from './memory/SettingsMemoryViewerCard.vue';
import { useI18n } from '../../i18n';
import type { Provider } from '@iki/backend/types/provider';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

withDefaults(
  defineProps<{
    active: boolean;
    providers?: Provider[];
  }>(),
  {
    providers: () => [],
  }
);

const { t } = useI18n();
</script>

<style scoped src="./settings_shared.css"></style>
<style src="./settings_memory.css"></style>
