<template>
  <div class="settings-container">
    <div class="titlebar-drag-region"></div>
    <!-- Left Nav: a tab list, so the four sections are one stop in the Tab
         order and arrow keys move between them. -->
    <nav class="settings-nav" :aria-label="t('a11y.settingsNav')">
      <ul class="nav-menu" role="tablist" :aria-label="t('a11y.settingsNav')">
        <li v-for="(item, index) in menuItems" :key="item.key" role="presentation">
          <button
            :id="settingsTabId(item.key)"
            type="button"
            role="tab"
            class="nav-menu-tab"
            :class="{ active: activeSection === item.key }"
            :title="item.label"
            :aria-label="t('a11y.settingsSectionTab', { name: item.label })"
            :aria-selected="activeSection === item.key ? 'true' : 'false'"
            :aria-controls="settingsPanelId(item.key)"
            :tabindex="activeSection === item.key ? 0 : -1"
            @click="selectSection(item.key)"
            @keydown="handleTabKeydown($event, index)"
          >
            <span class="icon">
              <component :is="item.icon" :size="20" />
            </span>
            <span class="nav-label">{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </nav>

    <!-- Right Side Config Panel -->
    <main class="settings-content" :aria-label="t('a11y.settingsContent')">
      <div class="settings-header">
        <div class="settings-header-left">
          <span class="icon"><component :is="activeSectionIcon" :size="22" /></span>
          <span class="title">{{ activeSectionLabel }}</span>
        </div>
        <div class="settings-header-right" :class="{ 'is-unsaved': !saved || providerDraftDirty }">
          <span class="unsaved-dot" />
          <span>{{
            saved && !providerDraftDirty ? t('settings.saved.all') : t('settings.saved.unsaved')
          }}</span>
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

        <!-- Dev-only row: restart so main-process edits apply. Renders nothing
             in the packaged app. -->
        <SettingsDevSection />
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

      <!-- 技能: what the agent can do. -->
      <section v-show="activeSection === 'intelligence'" class="settings-page">
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
        <span v-if="saved && !providerDraftDirty" class="save-status">{{
          t('settings.saved.all')
        }}</span>
        <div class="footer-actions">
          <button class="secondary" @click="$emit('close')">{{ t('common.close') }}</button>
          <button class="primary" @click="saveAndClose">{{ t('common.save') }}</button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { AlarmClock, Bot, Brain, Cog } from 'lucide-vue-next';

import SettingsGeneralSection from '../components/settings/SettingsGeneralSection.vue';
import SettingsUiSection from '../components/settings/SettingsUiSection.vue';
import SettingsSecuritySection from '../components/settings/SettingsSecuritySection.vue';
import SettingsKeybindingsSection from '../components/settings/SettingsKeybindingsSection.vue';
import SettingsDevSection from '../components/settings/SettingsDevSection.vue';
import ProvidersSettings from '../components/settings/ProvidersSettings.vue';
import McpSettings from '../components/settings/McpSettings.vue';
import NapCatSettings from '../components/settings/NapCatSettings.vue';
import SettingsColorSchemeSection from '../components/settings/SettingsColorSchemeSection.vue';
import SettingsNetworkSection from '../components/settings/SettingsNetworkSection.vue';
import SettingsSpeechSection from '../components/settings/SettingsSpeechSection.vue';
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
// Mirrors <ProvidersSettings />'s own dirty state. The footer/header used to
// claim "All changes saved" while a provider draft was still unsaved.
const providerDraftDirty = ref(false);
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

// Tab ids are derived from the section key so the tab and its panel can point
// at each other without threading a ref through the template.
const settingsTabId = (key: string) => `settings-tab-${key}`;
const settingsPanelId = (key: string) => `settings-panel-${key}`;

const selectSection = (key: string) => {
  activeSection.value = key;
};

// Roving tabindex: the tab list is one Tab stop and arrow keys move within it
// (Home/End jump to the ends), which is what the tablist pattern expects.
const handleTabKeydown = (event: KeyboardEvent, index: number) => {
  const items = menuItems.value;
  if (items.length === 0) return;
  const key = event.key;
  const move = (nextIndex: number) => {
    event.preventDefault();
    const target = items[(nextIndex + items.length) % items.length];
    if (!target) return;
    selectSection(target.key);
    void nextTick(() => document.getElementById(settingsTabId(target.key))?.focus());
  };

  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      move(index + 1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      move(index - 1);
      break;
    case 'Home':
      move(0);
      break;
    case 'End':
      move(items.length - 1);
      break;
    default:
      break;
  }
};

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

const PROVIDER_DRAFT_FLUSH_EVENT = 'iki:providers:flush-draft';
const PROVIDER_DRAFT_DIRTY_EVENT = 'iki:providers:draft-dirty';

/**
 * Ask the mounted <ProvidersSettings /> to persist its dirty draft. Providers
 * are a separate store from AppConfig, so the footer Save cannot write them
 * directly. The event is answered with whether a save happened; if the section
 * is not mounted (or unmounted mid-flight) this resolves false and the footer
 * behaves exactly as before.
 */
const flushProviderDraft = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return false;
  }

  return await new Promise<boolean>(resolve => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => settle(false), 5000);

    window.dispatchEvent(
      new CustomEvent(PROVIDER_DRAFT_FLUSH_EVENT, {
        detail: { resolve: settle },
      })
    );
  });
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
  // Providers live in their own store; flush a dirty provider draft before
  // writing AppConfig, otherwise this button drops those edits while the
  // header still reports "All changes saved".
  await flushProviderDraft();
  await configStore.saveConfig();
  saved.value = true;
  emit('close');
};

onMounted(async () => {
  window.addEventListener(PROVIDER_DRAFT_DIRTY_EVENT, handleProviderDraftDirty);

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
  window.removeEventListener(PROVIDER_DRAFT_DIRTY_EVENT, handleProviderDraftDirty);
  removeProviderUpdateListener();
});

const handleProviderDraftDirty = (event: Event) => {
  const detail = (event as CustomEvent<{ dirty?: boolean }>).detail;
  providerDraftDirty.value = detail?.dirty === true;
};
</script>

<style scoped src="../components/settings/settings_shared.css"></style>
<style scoped src="./settings_view.css"></style>
