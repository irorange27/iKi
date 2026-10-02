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
      <!-- 通用: lightweight preferences live together on one page. -->
      <section v-show="activeSection === 'general'" class="settings-page">
        <SettingsGeneralSection
          :providers="providers"
          @config-change="autoSave"
          @reset="resetSection('general')"
        />

        <h2 class="settings-page-title">{{ t('settings.menu.ui') }}</h2>
        <SettingsUiSection @config-change="autoSave" @reset="resetSection('ui')" />

        <h2 class="settings-page-title">{{ t('settings.menu.speech') }}</h2>
        <SettingsSpeechSection
          :active="activeSection === 'general'"
          @config-change="autoSave"
          @reset="resetSection('speech')"
        />

        <h2 class="settings-page-title">{{ t('settings.menu.colorScheme') }}</h2>
        <SettingsColorSchemeSection
          :active="activeSection === 'general'"
          @config-change="autoSave"
          @reset="resetColorSchemeSection"
        />

        <h2 class="settings-page-title">{{ t('settings.menu.network') }}</h2>
        <SettingsNetworkSection
          :active="activeSection === 'general'"
          @config-change="autoSave"
          @reset="resetSection('network')"
        />

        <h2 class="settings-page-title">{{ t('settings.menu.security') }}</h2>
        <SettingsSecuritySection @config-change="autoSave" @reset="resetSection('security')" />

        <SettingsKeybindingsSection
          v-show="activeSection === 'keybindings'"
          @config-change="autoSave"
          @reset="resetSection('keybindings')"
        />
      </section>

      <!-- 模型与工具: providers, MCP servers, and API usage. -->
      <section v-show="activeSection === 'models'" class="settings-page">
        <h2 class="settings-page-title">{{ t('settings.menu.provider') }}</h2>
        <ProvidersSettings />

        <h2 class="settings-page-title">{{ t('settings.menu.mcp') }}</h2>
        <McpSettings @config-change="autoSave" />

        <h2 class="settings-page-title">{{ t('settings.menu.usage') }}</h2>
        <SettingsUsageSection :active="activeSection === 'models'" />
      </section>

      <!-- 记忆与技能: what the agent remembers and can do. -->
      <section v-show="activeSection === 'intelligence'" class="settings-page">
        <h2 class="settings-page-title">{{ t('settings.menu.memory') }}</h2>
        <SettingsMemorySection
          :active="activeSection === 'intelligence'"
          :providers="providers"
          @config-change="autoSave"
          @reset="resetSection('memory')"
        />

        <h2 class="settings-page-title">{{ t('settings.menu.skills') }}</h2>
        <SettingsSkillsSection
          :active="activeSection === 'intelligence'"
          @config-change="autoSave"
        />
      </section>

      <!-- 自动化: unattended entry points (QQ bridge, proactive tasks). -->
      <section v-show="activeSection === 'automation'" class="settings-page">
        <h2 class="settings-page-title">{{ t('settings.menu.bridges') }}</h2>
        <NapCatSettings
          :active="activeSection === 'automation'"
          @config-change="autoSave"
          @reset="resetBridgeSection"
        />

        <h2 class="settings-page-title">{{ t('settings.menu.tasks') }}</h2>
        <SettingsTasksSection
          :active="activeSection === 'automation'"
          :providers="availableProvidersWithModels"
        />
      </section>

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
import { AlarmClock, Bot, Brain, Cog } from 'lucide-vue-next';

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
import type { AppConfig } from '@iki/backend/types/config';
import type { Provider } from '@iki/backend/types/provider';
import { parseModelList } from '@iki/backend/utils/provider_models';
import { getProviderDisplayName } from '../modules/providers/provider_display';

const electronAPI = getElectronAPI();
const settingsViewLogger = createLogger({ module: 'settings_view' });
const { t } = useI18n();

const SETTINGS_SECTION_KEYS = new Set(['general', 'models', 'intelligence', 'automation']);

// Deep links (e.g. `#settings/tasks` from the sidebar automations entry) may
// still use the pre-merge section names; each maps onto its merged section.
const SETTINGS_SECTION_ALIASES: Record<string, string> = {
  provider: 'models',
  mcp: 'models',
  usage: 'models',
  memory: 'intelligence',
  skills: 'intelligence',
  bridges: 'automation',
  tasks: 'automation',
  ui: 'general',
  colorScheme: 'general',
  speech: 'general',
  network: 'general',
  security: 'general',
  keybindings: 'general',
};

const resolveSettingsSection = (value?: string): string => {
  if (typeof value !== 'string') return 'general';
  const trimmed = value.trim();
  if (SETTINGS_SECTION_KEYS.has(trimmed)) return trimmed;
  return SETTINGS_SECTION_ALIASES[trimmed] ?? 'general';
};

const props = defineProps<{
  initialSection?: string;
}>();
const emit = defineEmits<{ close: [] }>();
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
  { key: 'models', label: t('settings.menu.models'), icon: Bot },
  { key: 'intelligence', label: t('settings.menu.intelligence'), icon: Brain },
  { key: 'automation', label: t('settings.menu.automation'), icon: AlarmClock },
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
