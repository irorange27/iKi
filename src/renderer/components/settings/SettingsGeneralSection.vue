<template>
  <section class="config-section">
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
        v-for="key in ['startMinimized', 'minimizeToTray', 'closeToTray', 'autoUpdate'] as const"
        :key="key"
        class="checkbox-label"
      >
        <input
          type="checkbox"
          :checked="config.general[key as keyof typeof config.general] as boolean"
          @change="updateGeneral(key, ($event.target as HTMLInputElement).checked)"
        />
        {{ formatGeneralLabel(key) }}
      </label>
    </div>

    <div class="config-group">
      <h3>{{ t('settings.general.companion.title') }}</h3>
      <p class="group-description">{{ t('settings.general.companion.description') }}</p>
      <label
        v-for="key in [
          'enabled',
          'alwaysOnTop',
          'rememberPosition',
          'reduceMotion',
          'openMainWindowOnClick',
        ] as const"
        :key="key"
        class="checkbox-label"
      >
        <input
          type="checkbox"
          :checked="config.ui.companion[key]"
          @change="updateCompanion(key, ($event.target as HTMLInputElement).checked)"
        />
        {{ formatCompanionLabel(key) }}
      </label>
      <div
        class="companion-status-card"
        :class="{
          'companion-status-card-disabled': !config.ui.companion.enabled,
        }"
      >
        <div class="companion-status-copy">
          <span class="companion-status-title">
            {{
              config.ui.companion.enabled
                ? t('settings.general.companion.statusOnTitle')
                : t('settings.general.companion.statusOffTitle')
            }}
          </span>
          <span class="companion-status-description">
            {{
              config.ui.companion.enabled
                ? t('settings.general.companion.statusOnDescription')
                : t('settings.general.companion.statusOffDescription')
            }}
          </span>
        </div>
        <button
          v-if="!config.ui.companion.enabled"
          type="button"
          class="test-model-btn companion-show-btn"
          @click="updateCompanion('enabled', true)"
        >
          {{ t('settings.general.companion.showNow') }}
        </button>
      </div>
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

    <button class="reset-btn" @click="emit('reset')">
      {{ t('settings.general.reset') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import { RefreshCw } from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useSettingsGeneralSection } from '../../composables/useSettingsGeneralSection';
import type { Provider } from '../../../shared/types/provider';

const props = defineProps<{
  providers: Provider[];
}>();

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const { t } = useI18n();
const { providers } = toRefs(props);

const {
  canCheckForUpdates,
  canInstallDownloadedUpdate,
  canTestToolModel,
  checkForUpdatesNow,
  config,
  formatCompanionLabel,
  formatGeneralLabel,
  installDownloadedUpdate,
  isCheckingForUpdates,
  isLoadingUpdateStatus,
  isTestingModel,
  languageOptions,
  selectedToolModelOptionValue,
  shellApprovalDescription,
  shellApprovalModeOptions,
  testToolModel,
  toggleAutoApproveToolRequests,
  toolModelSelectOptions,
  toolModelTestResult,
  updateCompanion,
  updateGeneral,
  updateLanguageSelection,
  updateShellApprovalMode,
  updateStatus,
  updateStatusDescription,
  updateStatusMeta,
  updateStatusTitle,
  updateStatusTone,
  updateToolModelSelection,
} = useSettingsGeneralSection({
  providers,
  onConfigChange: () => emit('config-change'),
});
</script>

<style scoped src="./settings_shared.css"></style>
<style scoped src="./settings_general_section.css"></style>
