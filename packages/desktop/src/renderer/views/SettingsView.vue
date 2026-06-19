<template>
  <div class="settings-container">
    <div class="titlebar-drag-region"></div>
    <!-- Left Nav -->
    <aside class="settings-nav">
      <ul class="nav-menu">
        <li
          v-for="item in menuItems"
          :key="item.key"
          :class="{ active: activeSection === item.key }"
          @click="activeSection = item.key"
        >
          <span class="icon">
            <component :is="item.icon" :size="20" />
          </span>
          {{ item.label }}
        </li>
      </ul>
    </aside>

    <!-- Right Side Config Panel -->
    <main class="settings-content">
      <div class="settings-header">
        <div class="settings-header-left">
          <span class="icon"><component :is="activeSectionIcon" :size="22" /></span>
          <span class="title">{{ activeSectionLabel }}</span>
        </div>
        <div class="settings-header-right" :class="{ 'is-unsaved': !saved }">
          <span class="unsaved-dot" />
          <span>{{ saved ? t('settings.saved.all') : t('settings.saved.unsaved') }}</span>
        </div>
      </div>
      <SettingsGeneralSection
        v-show="activeSection === 'general'"
        :providers="providers"
        @config-change="autoSave"
        @reset="resetSection('general')"
      />

      <ProvidersSettings v-show="activeSection === 'provider'" />

      <McpSettings v-show="activeSection === 'mcp'" @config-change="autoSave" />

      <NapCatSettings
        :active="activeSection === 'bridges'"
        v-show="activeSection === 'bridges'"
        @config-change="autoSave"
        @reset="resetBridgeSection"
      />

      <SettingsSpeechSection
        v-show="activeSection === 'speech'"
        :active="activeSection === 'speech'"
        @config-change="autoSave"
        @reset="resetSection('speech')"
      />

      <SettingsColorSchemeSection
        v-show="activeSection === 'colorScheme'"
        :active="activeSection === 'colorScheme'"
        @config-change="autoSave"
        @reset="resetColorSchemeSection"
      />

      <SettingsUiSection
        v-show="activeSection === 'ui'"
        @config-change="autoSave"
        @reset="resetSection('ui')"
      />

      <SettingsNetworkSection
        v-show="activeSection === 'network'"
        :active="activeSection === 'network'"
        @config-change="autoSave"
        @reset="resetSection('network')"
      />

      <SettingsSecuritySection
        v-show="activeSection === 'security'"
        @config-change="autoSave"
        @reset="resetSection('security')"
      />


      <SettingsKeybindingsSection
        v-show="activeSection === 'keybindings'"
        @config-change="autoSave"
        @reset="resetSection('keybindings')"
      />

      <SettingsMemorySection
        v-show="activeSection === 'memory'"
        :active="activeSection === 'memory'"
        :providers="providers"
        @config-change="autoSave"
        @reset="resetSection('memory')"
      />

      <SettingsTasksSection
        v-show="activeSection === 'tasks'"
        :active="activeSection === 'tasks'"
        :providers="availableProvidersWithModels"
      />

      <SettingsUsageSection
        v-show="activeSection === 'usage'"
        :active="activeSection === 'usage'"
      />

      <SettingsSkillsSection
        v-show="activeSection === 'skills'"
        :active="activeSection === 'skills'"
        @config-change="autoSave"
      />

      <!-- Footer operabar -->
      <div class="settings-footer">
        <span v-if="saved" class="save-status">{{ t('settings.saved.all') }}</span>
        <div class="footer-actions">
          <button class="secondary" @click="$emit('close')">{{ t('common.close') }}</button>
          <button class="primary" @click="saveAndClose">{{ t('common.save') }}</button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  Cog,
  Palette,
  Mic,
  Brain,
  Bot,
  BarChart3,
  AlarmClock,
  Globe,
  Wand2,
  Plug,
  SlidersHorizontal,
} from 'lucide-vue-next';

import SettingsGeneralSection from '../components/settings/SettingsGeneralSection.vue';
import SettingsUiSection from '../components/settings/SettingsUiSection.vue';
import SettingsSecuritySection from '../components/settings/SettingsSecuritySection.vue';
import SettingsKeybindingsSection from '../components/settings/SettingsKeybindingsSection.vue';
import ProvidersSettings from '../components/settings/ProvidersSettings.vue';
import McpSettings from '../components/settings/McpSettings.vue';
import NapCatSettings from '../components/settings/NapCatSettings.vue';
import SettingsColorSchemeSection from '../components/settings/SettingsColorSchemeSection.vue';
import SettingsNetworkSection from '../components/settings/SettingsNetworkSection.vue';
import SettingsSpeechSection from '../components/settings/SettingsSpeechSection.vue';
import SettingsMemorySection from '../components/settings/SettingsMemorySection.vue';
import SettingsTasksSection from '../components/settings/SettingsTasksSection.vue';
import SettingsUsageSection from '../components/settings/SettingsUsageSection.vue';
import SettingsSkillsSection from '../components/settings/SettingsSkillsSection.vue';
import { useI18n } from '../i18n';
import { createLogger } from '../logger';
import { getElectronAPI } from '../services/electron_api';
import { useConfigStore } from '../store/config';
import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import type { AppConfig } from '@iki/core/types/config';
import type { Provider } from '@iki/core/types/provider';
import { parseModelList } from '@iki/core/utils/provider_models';
import { getProviderDisplayName } from '../modules/providers/provider_display';

const electronAPI = getElectronAPI();
const settingsViewLogger = createLogger({ module: 'settings_view' });
const { t } = useI18n();

const SETTINGS_SECTION_KEYS = new Set([
  'general',
  'provider',
  'mcp',
  'bridges',
  'usage',
  'skills',
  'memory',
  'network',
  'ui',
  'colorScheme',
  'speech',
  'tasks',
  'security',
  'keybindings',
]);

const resolveSettingsSection = (value?: string): string => {
  if (typeof value !== 'string') return 'general';
  const trimmed = value.trim();
  return SETTINGS_SECTION_KEYS.has(trimmed) ? trimmed : 'general';
};

const props = defineProps<{
  initialSection?: string;
}>();
const emit = defineEmits(['close']);
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const activeSection = ref(resolveSettingsSection(props.initialSection));
const saved = ref(true);
const providers = ref<Provider[]>([]);
let removeProviderUpdateListener: () => void = () => undefined;

watch(
  () => props.initialSection,
  nextValue => {
    activeSection.value = resolveSettingsSection(nextValue);
  }
);

type AvailableProvider = {
  id: string;
  name: string;
  type: string;
  models: string[];
};

// Load providers
const loadProviders = async () => {
  try {
    providers.value = await electronAPI.providers.list();
  } catch (error) {
    settingsViewLogger.event({
      level: 'error',
      event: 'settings.providers.load',
      outcome: 'failed',
      error,
    });
  }
};

// Computed: Get available providers with their models
const availableProvidersWithModels = computed<AvailableProvider[]>(() => {
  return providers.value
    .filter(provider => provider.enabled)
    .map(provider => {
      const models = parseModelList(provider.models);
      return {
        id: provider.id,
        name: getProviderDisplayName(provider),
        type: provider.type,
        models,
      };
    })
    .filter(provider => provider.models.length > 0);
});

const menuItems = computed(() => [
  { key: 'general', label: t('settings.menu.general'), icon: Cog },
  { key: 'provider', label: t('settings.menu.provider'), icon: Bot },
  { key: 'mcp', label: t('settings.menu.mcp'), icon: Plug },
  { key: 'bridges', label: t('settings.menu.bridges'), icon: Bot },
  { key: 'usage', label: t('settings.menu.usage'), icon: BarChart3 },
  { key: 'skills', label: t('settings.menu.skills'), icon: Wand2 },
  { key: 'memory', label: t('settings.menu.memory'), icon: Brain },
  { key: 'network', label: t('settings.menu.network'), icon: Globe },
  { key: 'ui', label: t('settings.menu.ui'), icon: SlidersHorizontal },
  { key: 'colorScheme', label: t('settings.menu.colorScheme'), icon: Palette },
  { key: 'speech', label: t('settings.menu.speech'), icon: Mic },
  { key: 'tasks', label: t('settings.menu.tasks'), icon: AlarmClock },
]);

const activeSectionMeta = computed(() => {
  return (
    menuItems.value.find(item => item.key === activeSection.value) || {
      key: activeSection.value,
      label: t('settings.fallbackTitle'),
      icon: Cog,
    }
  );
});

const activeSectionLabel = computed(() => activeSectionMeta.value.label);
const activeSectionIcon = computed(() => activeSectionMeta.value.icon);

// 自动保存防抖
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const autoSave = () => {
  saved.value = false;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await configStore.saveConfig();
    saved.value = true;
  }, 300);
};

const resetSection = async (section: keyof AppConfig) => {
  await configStore.resetSection(section);
  saved.value = true;
};

const resetColorSchemeSection = () => {
  const defaults = createDefaultAppConfig();
  config.value.general.theme = defaults.general.theme;
  config.value.general.themePresetId = defaults.general.themePresetId;
  config.value.themes = defaults.themes;
  autoSave();
};

const resetBridgeSection = async () => {
  await configStore.resetSection('bridges');
  await configStore.resetSection('daemon');
  saved.value = true;
};

const saveAndClose = async () => {
  clearTimeout(saveTimer);
  await configStore.saveConfig();
  saved.value = true;
  emit('close');
};

onMounted(async () => {
  if (typeof electronAPI.providers.onUpdated === 'function') {
    removeProviderUpdateListener = electronAPI.providers.onUpdated(() => {
      void loadProviders();
    });
  }
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  await loadProviders();
});

onBeforeUnmount(() => {
  removeProviderUpdateListener();
});
</script>

<style scoped src="../components/settings/settings_shared.css"></style>
<style scoped src="./settings_view.css"></style>
