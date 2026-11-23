<template>
  <div class="settings-container">
    <!-- Stationary back control anchored to the same y=26 axis as the native
         macOS window controls and ChatView's top-left chrome. -->
    <button
      class="settings-back-btn"
      type="button"
      :aria-label="t('settings.backToChat')"
      :title="t('settings.backToChat')"
      @click="saveAndClose"
    >
      <ArrowLeft :size="15" />
      <span>{{ t('settings.backToChat') }}</span>
    </button>

    <!-- Left Nav: concentric inset card matching Chat Sidebar language on desktop,
         collapsing cleanly to a scrollable pill bar on narrow viewports / web. -->
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
              <component :is="item.icon" :size="16" />
            </span>
            <span class="nav-label">{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </nav>

    <!-- Right Content Pane -->
    <main class="settings-content" :aria-label="t('a11y.settingsContent')">
      <header class="settings-header">
        <div class="settings-header-left">
          <span class="icon"><component :is="activeSectionIcon" :size="18" /></span>
          <h1 class="title">{{ activeSectionLabel }}</h1>
        </div>
        <div class="settings-header-drag-spacer" aria-hidden="true"></div>
        <div class="settings-header-right">
          <span
            class="settings-save-pill"
            :class="{ 'is-unsaved': !saved || providerDraftDirty }"
          >
            <span class="unsaved-dot" />
            <span>{{
              saved && !providerDraftDirty ? t('settings.saved.all') : t('settings.saved.unsaved')
            }}</span>
          </span>
          <button
            v-if="providerDraftDirty"
            type="button"
            class="settings-header-save-btn"
            @click="savePendingProviderDraft"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </header>

      <div class="settings-scroll-body">
        <section
          v-show="activeSection === 'general'"
          :id="settingsPanelId('general')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('general')"
        >
          <SettingsGeneralSection
            :providers="providers"
            @config-change="autoSave"
            @reset="resetSection('general')"
          />
        </section>

        <section
          v-show="activeSection === 'appearance'"
          :id="settingsPanelId('appearance')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('appearance')"
        >
          <SettingsColorSchemeSection
            :active="activeSection === 'appearance'"
            @config-change="autoSave"
            @reset="resetColorSchemeSection"
          />

          <h2 class="settings-page-title">{{ t('settings.menu.ui') }}</h2>
          <SettingsUiSection @config-change="autoSave" @reset="resetSection('ui')" />
        </section>

        <section
          v-show="activeSection === 'providers'"
          :id="settingsPanelId('providers')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('providers')"
        >
          <ProvidersSettings />
        </section>

        <section
          v-show="activeSection === 'mcp'"
          :id="settingsPanelId('mcp')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('mcp')"
        >
          <McpSettings @config-change="autoSave" />
        </section>

        <section
          v-show="activeSection === 'skills'"
          :id="settingsPanelId('skills')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('skills')"
        >
          <SettingsSkillsSection :active="activeSection === 'skills'" />
        </section>

        <section
          v-show="activeSection === 'system'"
          :id="settingsPanelId('system')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('system')"
        >
          <h2 class="settings-page-title">{{ t('settings.menu.speech') }}</h2>
          <SettingsSpeechSection
            :active="activeSection === 'system'"
            @config-change="autoSave"
            @reset="resetSection('speech')"
          />

          <h2 class="settings-page-title">{{ t('settings.menu.network') }}</h2>
          <SettingsNetworkSection
            :active="activeSection === 'system'"
            @config-change="autoSave"
            @reset="resetSection('network')"
          />

          <h2 class="settings-page-title">{{ t('settings.menu.security') }}</h2>
          <SettingsSecuritySection @config-change="autoSave" @reset="resetSection('security')" />

          <SettingsKeybindingsSection
            @config-change="autoSave"
            @reset="resetSection('keybindings')"
          />

          <SettingsDevSection />
        </section>

        <section
          v-show="activeSection === 'usage'"
          :id="settingsPanelId('usage')"
          class="settings-page"
          role="tabpanel"
          :aria-labelledby="settingsTabId('usage')"
        >
          <SettingsUsageSection :active="activeSection === 'usage'" />
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Cog,
  Palette,
  Plug,
  SlidersHorizontal,
  Sparkles,
} from '@lucide/vue';

import SettingsGeneralSection from '../components/settings/SettingsGeneralSection.vue';
import SettingsUiSection from '../components/settings/SettingsUiSection.vue';
import SettingsSecuritySection from '../components/settings/SettingsSecuritySection.vue';
import SettingsKeybindingsSection from '../components/settings/SettingsKeybindingsSection.vue';
import SettingsDevSection from '../components/settings/SettingsDevSection.vue';
import ProvidersSettings from '../components/settings/ProvidersSettings.vue';
import McpSettings from '../components/settings/McpSettings.vue';
import SettingsColorSchemeSection from '../components/settings/SettingsColorSchemeSection.vue';
import SettingsNetworkSection from '../components/settings/SettingsNetworkSection.vue';
import SettingsSpeechSection from '../components/settings/SettingsSpeechSection.vue';
import SettingsUsageSection from '../components/settings/SettingsUsageSection.vue';
import SettingsSkillsSection from '../components/settings/SettingsSkillsSection.vue';
import { useI18n } from '../i18n';
import { createLogger } from '../logger';
import { useSettingsClient } from '../services/settings_client';
import { useAppConfig } from '../composables/useAppConfig';
import { useConfigStore } from '../store/config';
import { createDefaultAppConfig } from '@iki/harness/config/defaults';
import type { AppConfig } from '@iki/core/types/config';
import type { Provider } from '@iki/core/types/provider';

const settingsClient = useSettingsClient();
const settingsViewLogger = createLogger({ module: 'settings_view' });
const { t } = useI18n();

const SETTINGS_SECTION_KEYS = new Set([
  'general',
  'appearance',
  'providers',
  'mcp',
  'skills',
  'system',
  'usage',
]);

const SETTINGS_SECTION_ALIASES: Record<string, string> = {
  models: 'providers',
  provider: 'providers',
  intelligence: 'skills',
  memory: 'skills',
  ui: 'appearance',
  colorScheme: 'appearance',
  speech: 'system',
  network: 'system',
  security: 'system',
  keybindings: 'system',
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
const providerDraftDirty = ref(false);
const providers = ref<Provider[]>([]);
let removeProviderUpdateListener: () => void = () => undefined;

watch(
  () => props.initialSection,
  nextValue => {
    activeSection.value = resolveSettingsSection(nextValue);
  }
);

const loadProviders = async () => {
  try {
    providers.value = await settingsClient.providers.list();
  } catch (error) {
    settingsViewLogger.event({
      level: 'error',
      event: 'settings.providers.load',
      outcome: 'failed',
      error,
    });
  }
};

const menuItems = computed(() => [
  { key: 'general', label: t('settings.menu.general'), icon: Cog },
  { key: 'appearance', label: t('settings.menu.appearance'), icon: Palette },
  { key: 'providers', label: t('settings.menu.provider'), icon: Bot },
  { key: 'mcp', label: t('settings.menu.mcp'), icon: Plug },
  { key: 'skills', label: t('settings.menu.skills'), icon: Sparkles },
  { key: 'system', label: t('settings.menu.system'), icon: SlidersHorizontal },
  { key: 'usage', label: t('settings.menu.usage'), icon: BarChart3 },
]);

const settingsTabId = (key: string) => `settings-tab-${key}`;
const settingsPanelId = (key: string) => `settings-panel-${key}`;

const selectSection = (key: string) => {
  activeSection.value = key;
};

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

const { debouncedSave, saveNow } = useAppConfig();
const autoSave = () => {
  saved.value = false;
  void debouncedSave().then(() => {
    saved.value = true;
  });
};

const PROVIDER_DRAFT_FLUSH_EVENT = 'iki:providers:flush-draft';
const PROVIDER_DRAFT_DIRTY_EVENT = 'iki:providers:draft-dirty';

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

const savePendingProviderDraft = async () => {
  await flushProviderDraft();
};

const saveAndClose = async () => {
  await flushProviderDraft();
  await saveNow();
  saved.value = true;
  emit('close');
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  const activeTag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
  event.preventDefault();
  void saveAndClose();
};

onMounted(async () => {
  window.addEventListener(PROVIDER_DRAFT_DIRTY_EVENT, handleProviderDraftDirty);
  window.addEventListener('keydown', handleKeydown);

  removeProviderUpdateListener = settingsClient.providers.onUpdated(() => {
    void loadProviders();
  });

  if (!configStore.initialized) {
    await configStore.initialize();
  }
  await loadProviders();
});

onBeforeUnmount(() => {
  window.removeEventListener(PROVIDER_DRAFT_DIRTY_EVENT, handleProviderDraftDirty);
  window.removeEventListener('keydown', handleKeydown);
  removeProviderUpdateListener();
});

const handleProviderDraftDirty = (event: Event) => {
  const detail = (event as CustomEvent<{ dirty?: boolean }>).detail;
  providerDraftDirty.value = detail?.dirty === true;
};
</script>

<style scoped src="../components/settings/settings_shared.css"></style>
<style scoped src="./settings_view.css"></style>
