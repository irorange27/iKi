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
      <!-- General -->
      <section v-show="activeSection === 'general'" class="config-section">
        <div class="config-group">
          <h3>{{ t('settings.general.toolModel.title') }}</h3>
          <p class="group-description">{{ t('settings.general.toolModel.description') }}</p>
          <div class="tool-model-selector">
            <div class="input-label">
              <div class="label-header">
                <span>{{ t('settings.general.toolModel.select') }}</span>
                <button
                  v-if="canTestToolModel"
                  class="test-model-btn"
                  @click="testToolModel"
                  :disabled="isTestingModel"
                >
                  <RefreshCw :size="14" :class="{ 'animate-spin': isTestingModel }" />
                  {{
                    isTestingModel
                      ? t('settings.general.toolModel.testing')
                      : t('settings.general.toolModel.test')
                  }}
                </button>
              </div>
              <SettingsSelect
                class="tool-model-select"
                :model-value="selectedToolModelOptionValue"
                :options="toolModelSelectOptions"
                :aria-label="t('settings.general.toolModel.select')"
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
                <strong>{{ t('settings.general.toolModel.usedForLabel') }}</strong>
                {{ t('settings.general.toolModel.usedFor') }}
              </p>
            </div>
          </div>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.general.shellApproval.title') }}</h3>
          <p class="group-description">{{ shellApprovalDescription }}</p>
          <div class="input-label">
            <span>{{ t('settings.general.shellApproval.label') }}</span>
            <SettingsSelect
              class="general-shell-approval-select"
              :model-value="config.toolExecution.shellApprovalMode"
              :options="shellApprovalModeOptions"
              :disabled="config.general.autoApproveToolRequests"
              :aria-label="t('settings.general.shellApproval.label')"
              @update:model-value="updateShellApprovalMode"
            />
          </div>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.general.language.title') }}</h3>
          <div class="input-label">
            <span>{{ t('settings.general.language.label') }}</span>
            <SettingsSelect
              class="general-language-select"
              :model-value="config.general.language"
              :options="languageOptions"
              :aria-label="t('settings.general.language.label')"
              @update:model-value="updateLanguageSelection"
            />
          </div>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.general.startupBehavior.title') }}</h3>
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
            {{ formatSettingLabel(key) }}
          </label>
        </div>

        <div class="config-group">
          <div class="update-status-header">
            <div>
              <h3>{{ t('settings.general.updates.title') }}</h3>
              <p class="group-description">{{ t('settings.general.updates.description') }}</p>
            </div>
            <span v-if="updateStatus" class="update-version-pill">
              v{{ updateStatus.currentVersion }}
            </span>
          </div>

          <div
            class="update-status-card"
            :class="updateStatusTone ? `update-status-card-${updateStatusTone}` : ''"
          >
            <template v-if="isLoadingUpdateStatus">
              <span class="update-status-title">{{ t('common.loading') }}</span>
              <span class="update-status-description">
                {{ t('settings.general.updates.loadingDescription') }}
              </span>
            </template>

            <template v-else-if="updateStatus">
              <div class="update-status-copy">
                <span class="update-status-title">{{ updateStatusTitle }}</span>
                <span class="update-status-description">{{ updateStatusDescription }}</span>
                <span v-if="updateStatusMeta" class="update-status-meta">
                  {{ updateStatusMeta }}
                </span>
              </div>
              <div class="update-status-actions">
                <button
                  type="button"
                  class="test-model-btn general-update-check-btn"
                  @click="checkForUpdatesNow"
                  :disabled="!canCheckForUpdates"
                >
                  <RefreshCw :size="14" :class="{ 'animate-spin': isCheckingForUpdates }" />
                  {{
                    isCheckingForUpdates
                      ? t('settings.general.updates.checking')
                      : t('settings.general.updates.checkNow')
                  }}
                </button>
                <button
                  v-if="canInstallDownloadedUpdate"
                  type="button"
                  class="update-install-btn"
                  @click="installDownloadedUpdate"
                >
                  {{ t('settings.general.updates.restartNow') }}
                </button>
              </div>
            </template>
          </div>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.general.permissionRequests.title') }}</h3>
          <p class="group-description">
            {{ t('settings.general.permissionRequests.description') }}
          </p>
          <button
            type="button"
            class="permission-request-card general-auto-approve-switch"
            :class="{
              'permission-request-card-enabled': config.general.autoApproveToolRequests,
            }"
            role="switch"
            :aria-checked="config.general.autoApproveToolRequests ? 'true' : 'false'"
            :aria-label="t('settings.general.permissionRequests.autoApproveAria')"
            @click="toggleAutoApproveToolRequests"
          >
            <span class="permission-request-copy">
              <span class="permission-request-title">
                {{ t('settings.general.permissionRequests.autoApproveTitle') }}
              </span>
              <span class="permission-request-description">
                {{ t('settings.general.permissionRequests.autoApproveDescription') }}
              </span>
              <span class="permission-request-warning">
                {{ t('settings.general.permissionRequests.autoApproveWarning') }}
              </span>
            </span>
            <span class="permission-request-switch" aria-hidden="true">
              <span class="permission-request-switch-thumb" />
            </span>
          </button>
        </div>

        <button class="reset-btn" @click="resetSection('general')">
          {{ t('settings.general.reset') }}
        </button>
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
            {{ t('settings.ui.fontSize') }}
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
            {{ t('settings.ui.chatContentPadding') }}
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
            {{ t('settings.ui.composerPadding') }}
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
            {{ t('settings.ui.bubbleHorizontalPadding') }}
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
            {{ t('settings.ui.bubbleVerticalPadding') }}
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
            {{ t('settings.ui.messageGap') }}
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
          <h3>{{ t('settings.ui.interfaceDensity') }}</h3>
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

        <button class="reset-btn" @click="resetSection('ui')">{{ t('settings.ui.reset') }}</button>
      </section>

      <!-- Network -->
      <section v-show="activeSection === 'network'" class="config-section">
        <div class="config-group">
          <h3>{{ t('settings.network.proxy.title') }}</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.network.proxy.enable"
              @change="updateNetwork('proxy.enable', ($event.target as HTMLInputElement).checked)"
            />
            {{ t('settings.network.proxy.enable') }}
          </label>

          <template v-if="config.network.proxy.enable">
            <div class="input-label">
              <span>{{ t('settings.network.proxy.type') }}</span>
              <SettingsSelect
                class="network-proxy-type-select"
                :model-value="config.network.proxy.type"
                :options="proxyTypeOptions"
                :aria-label="t('settings.network.proxy.typeAria')"
                @update:model-value="updateProxyTypeSelection"
              />
            </div>

            <label class="input-label"
              >{{ t('settings.network.proxy.host') }}
              <input
                type="text"
                :value="config.network.proxy.host"
                @input="updateNetwork('proxy.host', getInputValue($event))"
              />
            </label>

            <label class="input-label"
              >{{ t('settings.network.proxy.port') }}
              <input
                type="number"
                :value="config.network.proxy.port || ''"
                @input="updateNetwork('proxy.port', parseOptionalInteger(getInputValue($event)))"
              />
            </label>
          </template>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.network.timeoutRetryTitle') }}</h3>
          <div class="slider-field">
            <span>{{ t('settings.network.timeoutMs') }}</span>
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
          <p class="slider-hint">{{ t('settings.network.timeoutHint') }}</p>

          <div class="slider-field">
            <span>{{ t('settings.network.retryAttempts') }}</span>
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
          <p class="slider-hint">{{ t('settings.network.retryHint') }}</p>
        </div>

        <button class="reset-btn" @click="resetSection('network')">{{ t('settings.network.reset') }}</button>
      </section>

      <!-- Security -->
      <section v-show="activeSection === 'security'" class="config-section">
        <div class="config-group">
          <h3>{{ t('settings.security.dataProtection') }}</h3>
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
            {{ formatSecurityLabel(key) }}
          </label>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.security.sessionTimeout') }}</h3>
          <div class="slider-field">
            <span>{{ t('settings.security.minutes') }}</span>
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
          <p class="slider-hint">{{ t('settings.security.timeoutHint') }}</p>
        </div>

        <div class="config-group">
          <h3>{{ t('settings.security.logging') }}</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.security.enableLogging"
              @change="updateSecurity('enableLogging', getCheckedValue($event))"
            />
            {{ t('settings.security.enableLogging') }}
          </label>
          <div v-if="config.security.enableLogging" class="input-label">
            <span>{{ t('settings.security.level') }}</span>
            <SettingsSelect
              class="security-log-level-select"
              :model-value="config.security.logLevel"
              :options="securityLogLevelOptions"
              :aria-label="t('settings.security.levelAria')"
              @update:model-value="updateSecurityLogLevelSelection"
            />
          </div>
        </div>

        <button class="reset-btn" @click="resetSection('security')">{{ t('settings.security.reset') }}</button>
      </section>

      <!-- Advanced -->
      <section v-show="activeSection === 'advanced'" class="config-section">
        <div class="config-group">
          <h3>{{ t('settings.advanced.title') }}</h3>
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
            {{ formatAdvancedLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('advanced')">{{ t('settings.advanced.reset') }}</button>
      </section>

      <!-- Keybindings -->
      <section v-show="activeSection === 'keybindings'" class="config-section">
        <div class="config-group">
          <label v-for="(value, key) in config.keybindings" :key="key" class="input-label">
            {{ formatKeybindingLabel(key) }}:
            <input
              type="text"
              :value="value"
              @input="updateKeybinding(key, getInputValue($event))"
            />
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('keybindings')">{{ t('settings.keybindings.reset') }}</button>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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
import { useI18n } from '../i18n';
import { createLogger } from '../logger';
import { getElectronAPI } from '../services/electron_api';
import { updateService } from '../services/update_service';
import { useConfigStore } from '../store/config';
import { createDefaultAppConfig } from '../../shared/config/defaults';
import type { AppConfig } from '../../shared/types/config';
import type { Provider } from '../../shared/types/provider';
import type { AppUpdateStatus } from '../../shared/types/update';
import { parseModelList } from '../../shared/utils/provider_models';
import { formatLabel } from '../components/settings/settings_formatters';

const electronAPI = getElectronAPI();
const settingsViewLogger = createLogger({ module: 'settings_view' });
const { t } = useI18n();

const emit = defineEmits(['close']);
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const activeSection = ref('general');
const saved = ref(true);
const providers = ref<Provider[]>([]);
const isTestingModel = ref(false);
const isLoadingUpdateStatus = ref(true);
const toolModelTestResult = ref<{
  status: 'success' | 'warning' | 'error';
  message: string;
} | null>(null);
const updateStatus = ref<AppUpdateStatus | null>(null);
let removeProviderUpdateListener = () => undefined;

type AvailableProvider = {
  id: string;
  name: string;
  type: string;
  models: string[];
};

type ToolModelSelection = {
  providerType: string;
  model: string;
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

const AUTO_DETECT_TOOL_MODEL_VALUE = '';

const serializeToolModelSelection = (selection: ToolModelSelection): string =>
  JSON.stringify([selection.providerType, selection.model]);

const parseToolModelSelection = (value: string): ToolModelSelection | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return null;
    }

    const [providerType, model] = parsed;
    if (typeof providerType !== 'string' || typeof model !== 'string') {
      return null;
    }

    const trimmedProviderType = providerType.trim();
    const trimmedModel = model.trim();
    if (!trimmedProviderType || !trimmedModel) {
      return null;
    }

    return {
      providerType: trimmedProviderType,
      model: trimmedModel,
    };
  } catch {
    return null;
  }
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
  {
    value: AUTO_DETECT_TOOL_MODEL_VALUE,
    label: t('settings.general.toolModel.autoDetectRecommended'),
  },
  ...availableProvidersWithModels.value.map(provider => ({
    label: provider.name,
    options: provider.models.map(model => ({
      value: serializeToolModelSelection({ providerType: provider.type, model }),
      label: model,
    })),
  })),
]);

const shellApprovalModeOptions = computed(() => [
  { value: 'always', label: t('settings.general.shellApproval.alwaysRequired') },
]);

const languageOptions = computed(() => [
  { value: 'en', label: t('language.english') },
  { value: 'zh-CN', label: t('language.chineseSimplified') },
]);

const proxyTypeOptions = computed(() => [
  { value: 'http', label: t('settings.network.proxy.http') },
  { value: 'https', label: t('settings.network.proxy.https') },
  { value: 'socks5', label: t('settings.network.proxy.socks5') },
]);

const securityLogLevelOptions = computed(() => [
  { value: 'error', label: t('settings.security.logLevel.error') },
  { value: 'warn', label: t('settings.security.logLevel.warn') },
  { value: 'info', label: t('settings.security.logLevel.info') },
  { value: 'debug', label: t('settings.security.logLevel.debug') },
]);

const resolveConfiguredProviderType = (model: string): string | null => {
  for (const provider of availableProvidersWithModels.value) {
    if (provider.models.includes(model)) {
      return provider.type;
    }
  }

  return null;
};

const configuredToolModelSelection = computed<ToolModelSelection | null>(() => {
  const configuredModel = config.value.toolModel.model.trim();
  if (!configuredModel) return null;

  const configuredProviderType =
    config.value.toolModel.providerType.trim() || resolveConfiguredProviderType(configuredModel);
  if (!configuredProviderType) return null;

  return {
    providerType: configuredProviderType,
    model: configuredModel,
  };
});

const selectedToolModelOptionValue = computed(() => {
  const configuredModel = config.value.toolModel.model.trim();
  if (!configuredModel) {
    return AUTO_DETECT_TOOL_MODEL_VALUE;
  }

  if (!configuredToolModelSelection.value) {
    return serializeToolModelSelection({
      providerType: config.value.toolModel.providerType.trim() || '__unresolved__',
      model: configuredModel,
    });
  }

  return serializeToolModelSelection(configuredToolModelSelection.value);
});

const canTestToolModel = computed(() => availableProvidersWithModels.value.length > 0);
const shellApprovalDescription = computed(() =>
  config.value.general.autoApproveToolRequests
    ? t('settings.general.shellApproval.bypassed')
    : t('settings.general.shellApproval.description')
);
const isCheckingForUpdates = computed(
  () => updateStatus.value?.state === 'checking' || updateStatus.value?.state === 'downloading'
);
const canCheckForUpdates = computed(
  () =>
    Boolean(updateStatus.value?.supported) &&
    !isCheckingForUpdates.value &&
    updateStatus.value?.state !== 'downloaded'
);
const canInstallDownloadedUpdate = computed(() => updateStatus.value?.state === 'downloaded');

const formatUpdateTimestamp = (value: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = config.value.general.language === 'zh-CN' ? 'zh-CN' : 'en';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const getUpdateIntervalHours = (value: number | null): number => {
  if (!value || value <= 0) return 0;
  return Math.max(1, Math.round(value / (60 * 60 * 1000)));
};

const updateStatusTone = computed<'success' | 'warning' | 'error' | ''>(() => {
  switch (updateStatus.value?.state) {
    case 'up-to-date':
    case 'downloaded':
      return 'success';
    case 'checking':
    case 'downloading':
    case 'unsupported':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return '';
  }
});

const updateStatusTitle = computed(() => {
  if (!updateStatus.value) return '';

  switch (updateStatus.value.state) {
    case 'unsupported':
      return t('settings.general.updates.unsupportedTitle');
    case 'checking':
      return t('settings.general.updates.checkingTitle');
    case 'downloading':
      return t('settings.general.updates.downloadingTitle');
    case 'downloaded':
      return t('settings.general.updates.downloadedTitle');
    case 'up-to-date':
      return t('settings.general.updates.upToDateTitle');
    case 'error':
      return t('settings.general.updates.errorTitle');
    case 'idle':
    default:
      return updateStatus.value.autoUpdateEnabled
        ? t('settings.general.updates.idleAutoTitle')
        : t('settings.general.updates.idleManualTitle');
  }
});

const updateStatusDescription = computed(() => {
  if (!updateStatus.value) return '';

  switch (updateStatus.value.state) {
    case 'unsupported':
      switch (updateStatus.value.unsupportedReason) {
        case 'platform':
          return t('settings.general.updates.unsupportedPlatform');
        case 'not-packaged':
          return t('settings.general.updates.unsupportedNotPackaged');
        case 'first-run':
          return t('settings.general.updates.unsupportedFirstRun');
        case 'repository-unavailable':
          return t('settings.general.updates.unsupportedRepository');
        default:
          return t('settings.general.updates.unsupportedGeneric');
      }
    case 'checking':
      return t('settings.general.updates.checkingDescription');
    case 'downloading':
      return t('settings.general.updates.downloadingDescription');
    case 'downloaded':
      return t('settings.general.updates.downloadedDescription');
    case 'up-to-date':
      return t('settings.general.updates.upToDateDescription');
    case 'error':
      return t('settings.general.updates.errorDescription', {
        error: updateStatus.value.error || t('common.unknown'),
      });
    case 'idle':
    default:
      return updateStatus.value.autoUpdateEnabled
        ? t('settings.general.updates.idleAutoDescription', {
            hours: getUpdateIntervalHours(updateStatus.value.checkIntervalMs),
          })
        : t('settings.general.updates.idleManualDescription');
  }
});

const updateStatusMeta = computed(() => {
  if (!updateStatus.value) return '';
  if (updateStatus.value.releaseName) {
    return t('settings.general.updates.metaRelease', {
      release: updateStatus.value.releaseName,
    });
  }
  if (updateStatus.value.lastCheckedAt) {
    return t('settings.general.updates.metaLastChecked', {
      time: formatUpdateTimestamp(updateStatus.value.lastCheckedAt),
    });
  }
  return '';
});

const formatTestedToolModel = (selection: ToolModelSelection): string =>
  `${selection.model} (${selection.providerType})`;

let removeUpdateStatusListener: () => void = () => undefined;

const loadUpdateStatus = async () => {
  isLoadingUpdateStatus.value = true;
  try {
    updateStatus.value = await updateService.getStatus();
  } catch (error) {
    settingsViewLogger.event({
      level: 'warn',
      event: 'settings.updates.load',
      outcome: 'failed',
      error,
      message: 'Failed to load update status.',
    });
    updateStatus.value = {
      state: 'error',
      autoUpdateEnabled: config.value.general.autoUpdate,
      supported: false,
      checkIntervalMs: null,
      currentVersion: '',
      lastCheckedAt: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      updateUrl: null,
      error: getErrorMessage(error),
      unsupportedReason: null,
    };
  } finally {
    isLoadingUpdateStatus.value = false;
  }
};

const checkForUpdatesNow = async () => {
  try {
    updateStatus.value = await updateService.check();
  } catch (error) {
    settingsViewLogger.event({
      level: 'warn',
      event: 'settings.updates.check',
      outcome: 'failed',
      error,
      message: 'Failed to trigger update check.',
    });
    if (updateStatus.value) {
      updateStatus.value = {
        ...updateStatus.value,
        state: 'error',
        error: getErrorMessage(error),
      };
    }
  }
};

const installDownloadedUpdate = async () => {
  try {
    await updateService.install();
  } catch (error) {
    settingsViewLogger.event({
      level: 'warn',
      event: 'settings.updates.install',
      outcome: 'failed',
      error,
      message: 'Failed to install downloaded update.',
    });
    if (updateStatus.value) {
      updateStatus.value = {
        ...updateStatus.value,
        state: 'error',
        error: getErrorMessage(error),
      };
    }
  }
};

// Test tool model latency
const testToolModel = async () => {
  if (!canTestToolModel.value) return;

  isTestingModel.value = true;
  toolModelTestResult.value = null;

  try {
    const result = await electronAPI.toolModel.testLatency(configuredToolModelSelection.value);
    if (
      !result.success ||
      typeof result.responseTimeMs !== 'number' ||
      !result.providerType ||
      !result.model
    ) {
      toolModelTestResult.value = {
        status: 'error',
        message: t('settings.general.toolModel.latencyFailed', {
          error: result.error || 'Unknown error',
        }),
      };
      return;
    }

    const testedToolModel = formatTestedToolModel({
      providerType: result.providerType,
      model: result.model,
    });
    const responseTime = result.responseTimeMs / 1000;

    if (responseTime < 2.5) {
      toolModelTestResult.value = {
        status: 'success',
        message: t('settings.general.toolModel.good', {
          time: responseTime.toFixed(2),
          model: testedToolModel,
        }),
      };
    } else if (responseTime < 5) {
      toolModelTestResult.value = {
        status: 'warning',
        message: t('settings.general.toolModel.slow', {
          time: responseTime.toFixed(2),
          model: testedToolModel,
        }),
      };
    } else {
      toolModelTestResult.value = {
        status: 'error',
        message: t('settings.general.toolModel.unusable', {
          time: responseTime.toFixed(2),
          model: testedToolModel,
        }),
      };
    }
  } catch (error: unknown) {
    toolModelTestResult.value = {
      status: 'error',
      message: t('settings.general.toolModel.latencyFailed', {
        error: getErrorMessage(error),
      }),
    };
  } finally {
    isTestingModel.value = false;
  }
};

const updateToolModelSelection = (value: string) => {
  toolModelTestResult.value = null;

  if (value === AUTO_DETECT_TOOL_MODEL_VALUE) {
    configStore.setToolModel({
      providerType: '',
      model: '',
    });
    autoSave();
    return;
  }

  const selection = parseToolModelSelection(value);
  if (!selection) {
    settingsViewLogger.event({
      level: 'warn',
      event: 'settings.tool_model.selection',
      outcome: 'skipped',
      message: 'Ignoring invalid tool model selection.',
      data: {
        raw_value: value,
      },
    });
    return;
  }

  configStore.setToolModel({
    providerType: selection.providerType,
    model: selection.model,
  });
  autoSave();
};

const updateToolExecution = <K extends keyof AppConfig['toolExecution']>(
  key: K,
  value: AppConfig['toolExecution'][K]
) => {
  configStore.updateToolExecution(key, value);
  autoSave();
};

const updateShellApprovalMode = (value: string) => {
  if (value === 'always') {
    updateToolExecution('shellApprovalMode', value);
  }
};

const menuItems = computed(() => [
  { key: 'general', label: t('settings.menu.general'), icon: Cog },
  { key: 'provider', label: t('settings.menu.provider'), icon: Bot },
  { key: 'mcp', label: t('settings.menu.mcp'), icon: Plug },
  { key: 'bridges', label: t('settings.menu.bridges'), icon: Bot },
  { key: 'usage', label: t('settings.menu.usage'), icon: BarChart3 },
  { key: 'skills', label: t('settings.menu.skills'), icon: Wand2 },
  { key: 'memory', label: t('settings.menu.memory'), icon: Brain },
  { key: 'life', label: t('settings.menu.life'), icon: Activity },
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

const densityOptions = computed(() => [
  { key: 'compact' as const, label: t('settings.ui.compact') },
  { key: 'comfortable' as const, label: t('settings.ui.comfortable') },
  { key: 'spacious' as const, label: t('settings.ui.spacious') },
]);

const formatSettingLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    startMinimized: t('settings.general.startMinimized'),
    minimizeToTray: t('settings.general.minimizeToTray'),
    closeToTray: t('settings.general.closeToTray'),
    autoUpdate: t('settings.general.autoUpdate'),
    quickChatHideOnBlur: t('settings.general.quickChatHideOnBlur'),
  };

  return translatedLabels[key] || formatLabel(key);
};

const formatSecurityLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    encryptApikeys: t('settings.security.encryptApiKeys'),
    requirePassword: t('settings.security.requirePassword'),
  };

  return translatedLabels[key] || formatLabel(key);
};

const formatAdvancedLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    debugMode: t('settings.advanced.debugMode'),
    developerMode: t('settings.advanced.developerMode'),
    enableExperimentalFeatures: t('settings.advanced.experimental'),
  };

  return translatedLabels[key] || formatLabel(key);
};

const formatKeybindingLabel = (key: string): string => {
  const translatedLabels: Record<string, string> = {
    sendMessage: t('settings.keybindings.sendMessage'),
    openSettings: t('settings.keybindings.openSettings'),
  };

  return translatedLabels[key] || formatLabel(key);
};

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

const toggleAutoApproveToolRequests = () => {
  updateGeneral('autoApproveToolRequests', !config.value.general.autoApproveToolRequests);
};

const updateNetwork = (path: NetworkUpdatePath, value: boolean | string | number | null) => {
  switch (path) {
    case 'proxy.enable':
      configStore.updateNetworkProxy('enable', value as boolean);
      break;
    case 'proxy.type':
      configStore.updateNetworkProxy('type', value as AppConfig['network']['proxy']['type']);
      break;
    case 'proxy.host':
      configStore.updateNetworkProxy('host', value as string);
      break;
    case 'proxy.port':
      configStore.updateNetworkProxy('port', value as number | null);
      break;
    case 'timeout':
      configStore.updateNetwork('timeout', value as number);
      break;
    case 'retryAttempts':
      configStore.updateNetwork('retryAttempts', value as number);
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
  configStore.updateSecurity(key, value);
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
  configStore.updateAdvanced(key, value);
  autoSave();
};
const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
  configStore.updateKeybinding(key, value);
  autoSave();
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
  removeUpdateStatusListener = updateService.onStatusChanged(status => {
    updateStatus.value = status;
    isLoadingUpdateStatus.value = false;
  });
  if (typeof electronAPI.providers.onUpdated === 'function') {
    removeProviderUpdateListener = electronAPI.providers.onUpdated(() => {
      void loadProviders();
    });
  }
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  await loadUpdateStatus();
  await loadProviders();
});

onBeforeUnmount(() => {
  removeUpdateStatusListener();
  removeProviderUpdateListener();
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

.update-status-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.update-version-pill {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.update-status-card {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
}

.update-status-card-success {
  border-color: rgba(var(--success-rgb), 0.3);
  background: rgba(var(--success-rgb), 0.1);
}

.update-status-card-warning {
  border-color: rgba(var(--warning-rgb), 0.28);
  background: rgba(var(--warning-rgb), 0.1);
}

.update-status-card-error {
  border-color: rgba(var(--danger-rgb), 0.28);
  background: rgba(var(--danger-rgb), 0.1);
}

.update-status-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.update-status-title {
  font-size: 0.98em;
  font-weight: 600;
  color: var(--text-primary);
}

.update-status-description {
  font-size: 0.92em;
  line-height: 1.55;
  color: var(--text-secondary);
}

.update-status-meta {
  font-size: 0.84em;
  color: var(--text-tertiary);
}

.update-status-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.update-install-btn {
  border: 1px solid rgba(var(--success-rgb), 0.42);
  background: rgba(var(--success-rgb), 0.18);
  color: var(--status-success-color);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.update-install-btn:hover {
  background: rgba(var(--success-rgb), 0.24);
  border-color: rgba(var(--success-rgb), 0.55);
}

@media (max-width: 760px) {
  .update-status-header,
  .update-status-card {
    flex-direction: column;
    align-items: stretch;
  }

  .update-status-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

.permission-request-card {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.permission-request-card:hover {
  border-color: color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  background: color-mix(in srgb, var(--bg-secondary) 72%, var(--accent-color) 6%);
}

.permission-request-card:focus-visible {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 22%, transparent);
}

.permission-request-card-enabled {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--bg-secondary) 68%, var(--accent-color) 10%);
}

.permission-request-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.permission-request-title {
  font-size: 0.98em;
  font-weight: 600;
  color: var(--text-primary);
}

.permission-request-description {
  font-size: 0.92em;
  line-height: 1.55;
  color: var(--text-secondary);
}

.permission-request-warning {
  font-size: 0.84em;
  color: var(--warning-color);
}

.permission-request-switch {
  position: relative;
  flex: 0 0 auto;
  width: 54px;
  height: 30px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 78%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.permission-request-card-enabled .permission-request-switch {
  background: color-mix(in srgb, var(--accent-color) 86%, white 14%);
  border-color: color-mix(in srgb, var(--accent-color) 88%, white 12%);
}

.permission-request-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.28);
  transition: transform 0.2s ease;
}

.permission-request-card-enabled .permission-request-switch-thumb {
  transform: translateX(24px);
}
</style>
