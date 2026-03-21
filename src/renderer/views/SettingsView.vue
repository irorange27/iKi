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
          <span>{{ saved ? 'All changes saved' : 'Unsaved changes' }}</span>
        </div>
      </div>
      <!-- General -->
      <section v-show="activeSection === 'general'" class="config-section">
        <div class="config-group">
          <h3>Tool Model</h3>
          <p class="group-description">
            The Tool Model is a dedicated model used for background AI operations, separate from
            your main chat model. This allows you to use a fast, cost-effective model for auxiliary
            tasks while using more capable models for conversation.
          </p>
          <div class="tool-model-selector">
            <div class="input-label">
              <div class="label-header">
                <span>Select Tool Model</span>
                <button
                  v-if="selectedToolModel"
                  class="test-model-btn"
                  @click="testToolModel"
                  :disabled="isTestingModel"
                >
                  <RefreshCw :size="14" :class="{ 'animate-spin': isTestingModel }" />
                  {{ isTestingModel ? 'Testing...' : 'Test' }}
                </button>
              </div>
              <SettingsSelect
                class="tool-model-select"
                :model-value="config.toolModel.model"
                :options="toolModelSelectOptions"
                aria-label="Select Tool Model"
                @update:model-value="updateToolModelSelection"
              />
            </div>
            <div v-if="toolModelTestResult" class="test-result" :class="toolModelTestResult.status">
              <span v-if="toolModelTestResult.status === 'success'">✅</span>
              <span v-else-if="toolModelTestResult.status === 'warning'">⚠️</span>
              <span v-else>❌</span>
              {{ toolModelTestResult.message }}
            </div>
            <div class="tool-model-info">
              <p class="info-text">
                <strong>Recommended models:</strong> gpt-4o-mini, claude-3-5-haiku,
                gemini-2.0-flash, deepseek-chat
              </p>
              <p class="info-text">
                <strong>What Tool Model does:</strong> Thread title generation, tool selection,
                parameter extraction, memory operations, and background tasks.
              </p>
              <p class="info-text warning-text">
                <strong>⚠️ Avoid reasoning models:</strong> Never use o1, o3, or extended thinking
                models as they are too slow for tool operations.
              </p>
            </div>
          </div>
        </div>

        <div class="config-group">
          <h3>Shell Tool Approval</h3>
          <p class="group-description">
            Configure when shell commands require manual approval before execution.
          </p>
          <div class="input-label">
            <span>Approval Mode</span>
            <SettingsSelect
              class="general-shell-approval-select"
              :model-value="config.toolExecution.shellApprovalMode"
              :options="shellApprovalModeOptions"
              aria-label="Shell Tool Approval Mode"
              @update:model-value="updateShellApprovalMode"
            />
          </div>
          <label class="input-label">
            <span>Custom High-risk Regex (one per line)</span>
            <textarea
              rows="5"
              :value="shellHighRiskPatternText"
              placeholder="Example: \\bgit\\s+push\\s+--force\\b"
              @input="updateShellHighRiskPatterns(($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <p class="group-description">
            Patterns here are matched in high-risk mode and force approval when matched.
          </p>
        </div>

        <div class="config-group">
          <h3>Language</h3>
          <div class="input-label">
            <span>Language</span>
            <SettingsSelect
              class="general-language-select"
              :model-value="config.general.language"
              :options="languageOptions"
              aria-label="Language"
              @update:model-value="updateLanguageSelection"
            />
          </div>
        </div>

        <div class="config-group">
          <h3>Startup Behavior</h3>
          <label
            v-for="key in [
              'startMinimized',
              'minimizeToTray',
              'closeToTray',
              'autoUpdate',
            ] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.general[key as keyof typeof config.general] as boolean"
              @change="updateGeneral(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('general')">Reset General</button>
      </section>

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

      <!-- UI -->
      <section v-show="activeSection === 'ui'" class="config-section">
        <div class="config-group">
          <h3>
            Font Size
            <span class="value-badge">{{ config.ui.fontSize }}px</span>
          </h3>
          <input
            type="range"
            min="10"
            max="32"
            :value="config.ui.fontSize"
            @input="setFontSize(parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>
            Chat Content Padding
            <span class="value-badge">{{ config.ui.chatContentPadding }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="40"
            :value="config.ui.chatContentPadding"
            @input="
              setUiMetric('chatContentPadding', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Composer Padding
            <span class="value-badge">{{ config.ui.composerPadding }}px</span>
          </h3>
          <input
            type="range"
            min="4"
            max="24"
            :value="config.ui.composerPadding"
            @input="
              setUiMetric('composerPadding', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Bubble Horizontal Padding
            <span class="value-badge">{{ config.ui.messageBubblePaddingX }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="28"
            :value="config.ui.messageBubblePaddingX"
            @input="
              setUiMetric(
                'messageBubblePaddingX',
                parseInt(($event.target as HTMLInputElement).value)
              )
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Bubble Vertical Padding
            <span class="value-badge">{{ config.ui.messageBubblePaddingY }}px</span>
          </h3>
          <input
            type="range"
            min="6"
            max="20"
            :value="config.ui.messageBubblePaddingY"
            @input="
              setUiMetric(
                'messageBubblePaddingY',
                parseInt(($event.target as HTMLInputElement).value)
              )
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Message Gap
            <span class="value-badge">{{ config.ui.messageGap }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="32"
            :value="config.ui.messageGap"
            @input="setUiMetric('messageGap', parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>Interface Density</h3>
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

        <button class="reset-btn" @click="resetSection('ui')">Reset UI</button>
      </section>

      <!-- Network -->
      <section v-show="activeSection === 'network'" class="config-section">
        <div class="config-group">
          <h3>Proxy</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.network.proxy.enable"
              @change="updateNetwork('proxy.enable', ($event.target as HTMLInputElement).checked)"
            />
            Enable Proxy
          </label>

          <template v-if="config.network.proxy.enable">
            <div class="input-label">
              <span>Type</span>
              <SettingsSelect
                class="network-proxy-type-select"
                :model-value="config.network.proxy.type"
                :options="proxyTypeOptions"
                aria-label="Proxy Type"
                @update:model-value="updateProxyTypeSelection"
              />
            </div>

            <label class="input-label"
              >Host
              <input
                type="text"
                :value="config.network.proxy.host"
                @input="updateNetwork('proxy.host', getInputValue($event))"
              />
            </label>

            <label class="input-label"
              >Port
              <input
                type="number"
                :value="config.network.proxy.port || ''"
                @input="updateNetwork('proxy.port', parseOptionalInteger(getInputValue($event)))"
              />
            </label>
          </template>
        </div>

        <div class="config-group">
          <h3>Timeout & Retry</h3>
          <div class="slider-field">
            <span>Timeout (ms)</span>
            <span class="value-badge">{{ config.network.timeout }}</span>
          </div>
          <input
            type="range"
            min="1000"
            max="20000"
            step="500"
            :value="config.network.timeout"
            @input="updateNetwork('timeout', parseRequiredInteger(getInputValue($event)))"
          />
          <p class="slider-hint">Controls how long the app waits before timing out.</p>

          <div class="slider-field">
            <span>Retry Attempts</span>
            <span class="value-badge">{{ config.network.retryAttempts }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            :value="config.network.retryAttempts"
            @input="updateNetwork('retryAttempts', parseRequiredInteger(getInputValue($event)))"
          />
          <p class="slider-hint">Number of retries before a request fails.</p>
        </div>

        <button class="reset-btn" @click="resetSection('network')">Reset Network</button>
      </section>

      <!-- Security -->
      <section v-show="activeSection === 'security'" class="config-section">
        <div class="config-group">
          <h3>Data Protection</h3>
          <label
            v-for="key in ['encryptApikeys', 'requirePassword'] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.security[key]"
              @change="updateSecurity(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <div class="config-group">
          <h3>Session Timeout</h3>
          <div class="slider-field">
            <span>Minutes</span>
            <span class="value-badge">{{ config.security.sessionTimeout }}</span>
          </div>
          <input
            type="range"
            min="5"
            max="240"
            step="5"
            :value="config.security.sessionTimeout"
            @input="updateSecurity('sessionTimeout', parseRequiredInteger(getInputValue($event)))"
          />
          <p class="slider-hint">Shorter timeouts increase security.</p>
        </div>

        <div class="config-group">
          <h3>Logging</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.security.enableLogging"
              @change="updateSecurity('enableLogging', getCheckedValue($event))"
            />
            Enable Logging
          </label>
          <div v-if="config.security.enableLogging" class="input-label">
            <span>Level</span>
            <SettingsSelect
              class="security-log-level-select"
              :model-value="config.security.logLevel"
              :options="securityLogLevelOptions"
              aria-label="Logging Level"
              @update:model-value="updateSecurityLogLevelSelection"
            />
          </div>
        </div>

        <button class="reset-btn" @click="resetSection('security')">Reset Security</button>
      </section>

      <!-- Advanced -->
      <section v-show="activeSection === 'advanced'" class="config-section">
        <div class="config-group">
          <h3>Development Mode</h3>
          <label
            v-for="key in ['debugMode', 'developerMode', 'enableExperimentalFeatures'] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.advanced[key]"
              @change="updateAdvanced(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('advanced')">Reset Advanced</button>
      </section>

      <!-- Keybindings -->
      <section v-show="activeSection === 'keybindings'" class="config-section">
        <div class="config-group">
          <label v-for="(value, key) in config.keybindings" :key="key" class="input-label">
            {{ formatLabel(key) }}:
            <input
              type="text"
              :value="value"
              @input="updateKeybinding(key, getInputValue($event))"
            />
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('keybindings')">Reset Keybindings</button>
      </section>

      <SettingsMemorySection
        v-show="activeSection === 'memory'"
        :active="activeSection === 'memory'"
        @config-change="autoSave"
        @reset="resetSection('memory')"
      />

      <SettingsLifeSection v-show="activeSection === 'life'" :active="activeSection === 'life'" />

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
        <span v-if="saved" class="save-status">All changes saved</span>
        <div class="footer-actions">
          <button class="secondary" @click="$emit('close')">Close</button>
          <button class="primary" @click="saveAndClose">Save</button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import {
  Cog,
  Palette,
  Mic,
  Brain,
  Activity,
  Bot,
  BarChart3,
  RefreshCw,
  AlarmClock,
  Wand2,
  Plug,
  SlidersHorizontal,
} from 'lucide-vue-next';

import ProvidersSettings from '../components/settings/ProvidersSettings.vue';
import McpSettings from '../components/settings/McpSettings.vue';
import NapCatSettings from '../components/settings/NapCatSettings.vue';
import SettingsColorSchemeSection from '../components/settings/SettingsColorSchemeSection.vue';
import SettingsSpeechSection from '../components/settings/SettingsSpeechSection.vue';
import SettingsMemorySection from '../components/settings/SettingsMemorySection.vue';
import SettingsLifeSection from '../components/settings/SettingsLifeSection.vue';
import SettingsTasksSection from '../components/settings/SettingsTasksSection.vue';
import SettingsUsageSection from '../components/settings/SettingsUsageSection.vue';
import SettingsSkillsSection from '../components/settings/SettingsSkillsSection.vue';
import SettingsSelect from '../components/settings/SettingsSelect.vue';
import { useConfigStore } from '../store/config';
import { createDefaultAppConfig } from '../../shared/config/defaults';
import type { AppConfig } from '../../shared/types/config';
import type { Provider } from '../../shared/types/provider';
import { parseModelList } from '../../shared/utils/provider_models';
import { formatLabel } from '../components/settings/settings_formatters';

const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;

const emit = defineEmits(['close']);
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const activeSection = ref('general');
const saved = ref(true);
const providers = ref<Provider[]>([]);
const isTestingModel = ref(false);
const toolModelTestResult = ref<{
  status: 'success' | 'warning' | 'error';
  message: string;
} | null>(null);

type AvailableProvider = {
  id: string;
  name: string;
  type: string;
  models: string[];
};

type NetworkUpdatePath =
  | 'proxy.enable'
  | 'proxy.type'
  | 'proxy.host'
  | 'proxy.port'
  | 'timeout'
  | 'retryAttempts';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const getInputValue = (event: Event): string =>
  (event.target as HTMLInputElement | null)?.value ?? '';

const getCheckedValue = (event: Event): boolean =>
  (event.target as HTMLInputElement | null)?.checked ?? false;

const parseRequiredInteger = (value: string): number => Number.parseInt(value || '0', 10);

const parseOptionalInteger = (value: string): number | null =>
  value ? Number.parseInt(value, 10) : null;

// Load providers
const loadProviders = async () => {
  try {
    providers.value = await electronAPI.providers.list();
  } catch (error) {
    console.error('Failed to load providers:', error);
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
        name: provider.name,
        type: provider.type,
        models: models.filter(model => {
          // Filter out reasoning models
          const lowerModel = model.toLowerCase();
          return (
            !lowerModel.includes('o1') &&
            !lowerModel.includes('o3') &&
            !lowerModel.includes('thinking')
          );
        }),
      };
    })
    .filter(provider => provider.models.length > 0);
});

const toolModelSelectOptions = computed(() => [
  { value: '', label: 'Auto-detect (Recommended)' },
  ...availableProvidersWithModels.value.map(provider => ({
    label: provider.name,
    options: provider.models.map(model => ({
      value: model,
      label: model,
    })),
  })),
]);

const shellApprovalModeOptions = [
  { value: 'high-risk', label: 'Only High-risk Commands (Recommended)' },
  { value: 'always', label: 'Always Require Approval' },
  { value: 'never', label: 'Never Require Approval' },
];

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];

const proxyTypeOptions = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks5', label: 'SOCKS5' },
];

const securityLogLevelOptions = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

// Computed: Get selected tool model
const selectedToolModel = computed(() => {
  return config.value.toolModel.model;
});

// Test tool model performance
const testToolModel = async () => {
  if (!selectedToolModel.value) return;

  isTestingModel.value = true;
  toolModelTestResult.value = null;

  try {
    const startTime = Date.now();
    // Send a simple test message
    const result = await electronAPI.chat.send({
      providerType: getProviderTypeForModel(selectedToolModel.value),
      model: selectedToolModel.value,
      messages: [{ role: 'user', content: 'Say "OK"' }],
    });
    const responseTime = (Date.now() - startTime) / 1000;

    if (result.success) {
      if (responseTime < 2.5) {
        toolModelTestResult.value = {
          status: 'success',
          message: `Good! Response time: ${responseTime.toFixed(2)}s - Optimal for tool operations`,
        };
      } else if (responseTime < 5) {
        toolModelTestResult.value = {
          status: 'warning',
          message: `Slow. Response time: ${responseTime.toFixed(2)}s - Usable but may feel sluggish`,
        };
      } else {
        toolModelTestResult.value = {
          status: 'error',
          message: `Unusable. Response time: ${responseTime.toFixed(2)}s - Too slow for responsive tool use`,
        };
      }
    } else {
      toolModelTestResult.value = {
        status: 'error',
        message: `Test failed: ${result.error || 'Unknown error'}`,
      };
    }
  } catch (error: unknown) {
    toolModelTestResult.value = {
      status: 'error',
      message: `Test failed: ${getErrorMessage(error)}`,
    };
  } finally {
    isTestingModel.value = false;
  }
};

// Get provider type for a model
const getProviderTypeForModel = (model: string): string => {
  for (const provider of availableProvidersWithModels.value) {
    if (provider.models.includes(model)) {
      return provider.type;
    }
  }
  return 'openai'; // Default fallback
};

const updateToolModel = <K extends keyof AppConfig['toolModel']>(
  key: K,
  value: AppConfig['toolModel'][K]
) => {
  config.value.toolModel[key] = value;
  autoSave();
};

const updateToolModelSelection = (value: string) => {
  updateToolModel('model', value);
};

const updateToolExecution = <K extends keyof AppConfig['toolExecution']>(
  key: K,
  value: AppConfig['toolExecution'][K]
) => {
  config.value.toolExecution[key] = value;
  autoSave();
};

const updateShellApprovalMode = (value: string) => {
  if (value === 'high-risk' || value === 'always' || value === 'never') {
    updateToolExecution('shellApprovalMode', value);
  }
};

const menuItems = [
  { key: 'general', label: 'General', icon: Cog },
  { key: 'provider', label: 'Providers', icon: Bot },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'bridges', label: 'Bridges', icon: Bot },
  { key: 'usage', label: 'Usage', icon: BarChart3 },
  { key: 'skills', label: 'Skills', icon: Wand2 },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'life', label: 'Life', icon: Activity },
  { key: 'ui', label: 'User Interface', icon: SlidersHorizontal },
  { key: 'colorScheme', label: 'Color Scheme', icon: Palette },
  { key: 'speech', label: 'Speech', icon: Mic },
  { key: 'tasks', label: 'Tasks', icon: AlarmClock },
  // { key: "chat", label: "Chat", icon: MessageCircleMore },
  // { key: "network", label: "Network", icon: Globe },
  // { key: "security", label: "Security", icon: Lock },
  // { key: "advanced", label: "Advanced", icon: Zap },
  // { key: "keybindings", label: "Keybindings", icon: Keyboard },
];

const activeSectionMeta = computed(() => {
  return (
    menuItems.find(item => item.key === activeSection.value) || {
      key: activeSection.value,
      label: 'Settings',
      icon: Cog,
    }
  );
});

const activeSectionLabel = computed(() => activeSectionMeta.value.label);
const activeSectionIcon = computed(() => activeSectionMeta.value.icon);

const densityOptions = [
  { key: 'compact' as const, label: 'Compact' },
  { key: 'comfortable' as const, label: 'Comfortable' },
  { key: 'spacious' as const, label: 'Spacious' },
];

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

// Action 封装
const setFontSize = (size: number) => {
  configStore.updateUi('fontSize', size);
  autoSave();
};

const setDensity = (density: AppConfig['ui']['density']) => {
  configStore.updateUi('density', density);
  autoSave();
};

const setUiMetric = (
  key:
    | 'chatContentPadding'
    | 'composerPadding'
    | 'messageBubblePaddingX'
    | 'messageBubblePaddingY'
    | 'messageGap',
  value: number
) => {
  configStore.updateUi(key, value);
  autoSave();
};

const updateGeneral = <K extends keyof AppConfig['general']>(
  key: K,
  value: AppConfig['general'][K]
) => {
  configStore.updateGeneral(key, value);
  autoSave();
};

const updateLanguageSelection = (value: string) => {
  if (value === 'en' || value === 'zh-CN') {
    updateGeneral('language', value);
  }
};

const updateNetwork = (path: NetworkUpdatePath, value: boolean | string | number | null) => {
  switch (path) {
    case 'proxy.enable':
      config.value.network.proxy.enable = value as boolean;
      break;
    case 'proxy.type':
      config.value.network.proxy.type = value as AppConfig['network']['proxy']['type'];
      break;
    case 'proxy.host':
      config.value.network.proxy.host = value as string;
      break;
    case 'proxy.port':
      config.value.network.proxy.port = value as number | null;
      break;
    case 'timeout':
      config.value.network.timeout = value as number;
      break;
    case 'retryAttempts':
      config.value.network.retryAttempts = value as number;
      break;
  }
  autoSave();
};

const updateProxyTypeSelection = (value: string) => {
  if (value === 'http' || value === 'https' || value === 'socks5') {
    updateNetwork('proxy.type', value);
  }
};

const updateSecurity = <K extends keyof AppConfig['security']>(
  key: K,
  value: AppConfig['security'][K]
) => {
  config.value.security[key] = value;
  autoSave();
};

const updateSecurityLogLevelSelection = (value: string) => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    updateSecurity('logLevel', value);
  }
};
const updateAdvanced = <K extends keyof AppConfig['advanced']>(
  key: K,
  value: AppConfig['advanced'][K]
) => {
  config.value.advanced[key] = value;
  autoSave();
};
const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
  config.value.keybindings[key] = value;
  autoSave();
};
const shellHighRiskPatternText = computed(() =>
  (config.value.toolExecution.shellHighRiskPatterns || []).join('\n')
);

const updateShellHighRiskPatterns = (value: string) => {
  const patterns = value
    .split(/\r?\n/)
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .slice(0, 100);
  updateToolExecution('shellHighRiskPatterns', patterns);
};

const resetSection = (section: keyof AppConfig) => {
  configStore.resetSection(section);
  saved.value = true;
};

const resetColorSchemeSection = () => {
  const defaults = createDefaultAppConfig();
  config.value.general.theme = defaults.general.theme;
  config.value.general.themePresetId = defaults.general.themePresetId;
  config.value.themes = defaults.themes;
  autoSave();
};

const resetBridgeSection = () => {
  configStore.resetSection('bridges');
  configStore.resetSection('daemon');
  saved.value = true;
};

const saveAndClose = async () => {
  await configStore.saveConfig();
  saved.value = true;
  emit('close');
};

onMounted(async () => {
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  await loadProviders();
});
</script>

<style scoped src="../components/settings/settings_shared.css"></style>

<style scoped>
/* 密度面板样式 */
/* section header styles replaced by settings-header */

/* 强制覆盖为暗色主题以匹配 ChatView */
.settings-container {
  display: flex;
  height: 100%;
  min-height: 0;
  font-size: var(--font-size);
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 4px 4px 0;
  gap: 6px;
  box-sizing: border-box;
}

/* Titlebar Drag Region */
.titlebar-drag-region {
  position: fixed;
  top: 4px;
  left: 4px;
  right: 4px;
  height: 20px;
  -webkit-app-region: drag;
  z-index: 9999;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}

::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--text-muted);
}

/* 左侧导航 */
.settings-nav {
  width: 220px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  padding: 24px 16px;
  padding-top: 40px;
  /* Space for drag region */
  box-shadow: var(--surface-shadow-md);
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.nav-menu {
  margin-top: 22px;
  list-style: none;
  border-color: var(--border-color);
}

.nav-menu li {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.nav-menu li:hover {
  background: var(--bg-hover);
}

.nav-menu li.active {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-primary));
  color: var(--accent-color);
  box-shadow: inset 3px 0 0 var(--accent-color);
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  padding: 0 22px;
  /* Space for fixed footer */
  overflow-y: auto;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 22px;
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 5;
  padding-left: 6px;
  padding-right: 6px;
}

.settings-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.2em;
  font-weight: 600;
  position: relative;
  padding-left: 10px;
}

.settings-header-left::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 999px;
  background: var(--accent-color);
}

.settings-header-left .icon {
  color: var(--accent-color);
}

.settings-header-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--text-secondary);
}

.settings-header-right.is-unsaved {
  color: var(--warning-color);
}

.settings-header-right .unsaved-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
}

.settings-header-right.is-unsaved .unsaved-dot {
  opacity: 1;
}

/* 主题按钮组 */
.button-group {
  display: flex;
  gap: 8px;
}

.button-group button {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.button-group button.active {
  background: var(--accent-color);
  color: var(--accent-contrast);
  border-color: var(--accent-color);
}

.theme-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.theme-editor-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.theme-json-editor {
  min-height: 320px;
  line-height: 1.45;
  font-family:
    'SF Mono', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Liberation Mono',
    monospace;
}

.success-text {
  color: var(--success-color);
}

/* 滑动条 */
.value-badge {
  background: var(--bg-active);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.875em;
}

/* 密度卡片 */
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

/* Compact: 小间距 */
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

/* Comfortable: 中等间距 */
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

/* Spacious: 大间距 */
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

/* 底部操作栏 */
.settings-footer {
  position: sticky;
  margin-top: auto;
  bottom: 0;
  padding: 16px 0 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  justify-content: flex-end;
  /* Always keep buttons on the right */
  align-items: center;
  z-index: 10;
}

.save-status {
  color: var(--success-color);
  font-size: 0.875em;
  margin-right: auto;
  /* Push buttons to the right */
  display: flex;
  align-items: center;
  gap: 4px;
}

.save-status::before {
  content: '✓';
  font-weight: bold;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.footer-actions button {
  padding: 8px 20px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
  font-size: 0.9em;
}

.footer-actions .secondary {
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-primary);
}

.footer-actions .secondary:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
}

.footer-actions .primary {
  background: var(--accent-color);
  color: var(--accent-contrast);
  box-shadow: var(--surface-shadow-sm);
}

.footer-actions .primary:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--surface-shadow-md);
}

.footer-actions .primary:active {
  transform: translateY(0);
}

/* Tool Model Selector Styles */
.tool-model-selector {
  margin-top: 12px;
}

.tool-model-select :deep(.settings-select-trigger-value),
.tool-model-select :deep(.settings-select-option-label) {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 13px;
}

.tool-model-select :deep(.settings-select-group-label) {
  font-size: 12px;
}

.label-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.test-model-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.test-model-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.test-model-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.test-result.success {
  background: rgba(var(--success-rgb), 0.15);
  color: var(--status-success-color);
  border: 1px solid rgba(var(--success-rgb), 0.3);
}

.test-result.warning {
  background: rgba(var(--warning-rgb), 0.15);
  color: var(--warning-color);
  border: 1px solid rgba(var(--warning-rgb), 0.3);
}

.test-result.error {
  background: rgba(var(--danger-rgb), 0.15);
  color: var(--danger-color);
  border: 1px solid rgba(var(--danger-rgb), 0.3);
}

.tool-model-info {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.info-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 8px 0;
}

.info-text:first-child {
  margin-top: 0;
}

.info-text:last-child {
  margin-bottom: 0;
}
</style>
