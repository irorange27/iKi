<template>
  <div class="providers-sidebar">
    <div class="providers-scroll-list">
      <div class="providers-scroll-list-inner">
        <div
          v-for="provider in sidebarProviders"
          :key="provider.id"
          class="provider-list-item"
          :class="{
            active: selectedProviderId === provider.id,
            configured: !provider.isCustom && isProviderConfigured(provider.id),
            custom: provider.isCustom,
          }"
          @click="emit('select-provider', provider.id)"
        >
          <span class="provider-icon">
            <LobeIcon
              v-if="!provider.isCustom"
              :name="getProviderIconName(provider.id)"
              :size="24"
            />
            <LobeIcon v-else v-bind="getCustomProviderIconProps(provider.icon)" :size="20" />
          </span>
          <div class="provider-item-main">
            <span class="provider-item-name">{{ provider.name }}</span>
            <span v-if="provider.isCustom" class="provider-item-badge">
              {{ t('settings.providers.customBadge') }}
            </span>
          </div>
          <span class="provider-status-dot" :class="{ enabled: provider.enabled }"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import LobeIcon from '../../Icon/LobeIcon.vue';
import { useI18n } from '../../../i18n';
import {
  getCustomProviderIconProps,
  getProviderIconName,
} from '../../../modules/providers/provider_icons';
import type { SidebarProvider } from './provider_settings_shared';

defineProps<{
  sidebarProviders: SidebarProvider[];
  selectedProviderId: string | null;
  isProviderConfigured: (providerId: string) => boolean;
}>();

const emit = defineEmits<{
  (event: 'select-provider', providerId: string): void;
}>();

const { t } = useI18n();
</script>

<style scoped src="../settings_shared.css"></style>
