<template>
  <div class="settings-footer">
    <span v-if="saved" class="save-status">{{ t('settings.saved.all') }}</span>
    <div class="footer-actions">
      <button class="secondary" @click="$emit('close')">{{ t('common.close') }}</button>
      <button class="primary" @click="$emit('save')">{{ t('common.save') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../i18n';

defineProps({
  saved: Boolean,
});

defineEmits(['close', 'save']);

const { t } = useI18n();
</script>
