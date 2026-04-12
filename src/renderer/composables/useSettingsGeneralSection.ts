import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { createLogger } from '../logger';
import { getElectronAPI } from '../services/electron_api';
import { updateService } from '../services/update_service';
import { useConfigStore } from '../store/config';
import { useI18n } from '../i18n';
import type { AppConfig } from '../../shared/types/config';
import type { Provider } from '../../shared/types/provider';
import type { AppUpdateStatus } from '../../shared/types/update';
import { getErrorMessage } from '../../shared/utils/errors';
import { parseModelList } from '../../shared/utils/provider_models';
import { getProviderDisplayName } from '../modules/providers/provider_display';
import { formatLabel } from '../components/settings/settings_formatters';

type AvailableProvider = {
  id: string;
  name: string;
  type: string;
  models: string[];
};

type ToolModelSelectionInput = {
  providerId?: string;
  providerType?: string;
  model: string;
};

type ResolvedToolModelSelection = {
  providerId: string;
  providerType: string;
  model: string;
};

const UNCONFIGURED_TOOL_MODEL_VALUE = '';

export const useSettingsGeneralSection = (params: {
  providers: Readonly<Ref<Provider[]>>;
  onConfigChange: () => void;
}) => {
  const electronAPI = getElectronAPI();
  const settingsGeneralLogger = createLogger({ module: 'settings_general_section' });
  const { t } = useI18n();
  const configStore = useConfigStore();
  const { config } = storeToRefs(configStore);

  const isTestingModel = ref(false);
  const isLoadingUpdateStatus = ref(true);
  const toolModelTestResult = ref<{
    status: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const updateStatus = ref<AppUpdateStatus | null>(null);

  const serializeToolModelSelection = (selection: { providerId: string; model: string }): string =>
    JSON.stringify([selection.providerId, selection.model]);

  const parseToolModelSelection = (value: string): ToolModelSelectionInput | null => {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== 2) {
        return null;
      }

      const [providerId, model] = parsed;
      if (typeof providerId !== 'string' || typeof model !== 'string') {
        return null;
      }

      const trimmedProviderId = providerId.trim();
      const trimmedModel = model.trim();
      if (!trimmedProviderId || !trimmedModel) {
        return null;
      }

      return {
        providerId: trimmedProviderId,
        model: trimmedModel,
      };
    } catch {
      return null;
    }
  };

  const availableProvidersWithModels = computed<AvailableProvider[]>(() => {
    return params.providers.value
      .filter(provider => provider.enabled)
      .map(provider => ({
        id: provider.id,
        name: getProviderDisplayName(provider),
        type: provider.type,
        models: parseModelList(provider.models),
      }))
      .filter(provider => provider.models.length > 0);
  });

  const toolModelSelectOptions = computed(() => [
    {
      value: UNCONFIGURED_TOOL_MODEL_VALUE,
      label: t('settings.general.toolModel.unconfigured'),
    },
    ...availableProvidersWithModels.value.map(provider => ({
      label: provider.name,
      options: provider.models.map(model => ({
        value: serializeToolModelSelection({ providerId: provider.id, model }),
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

  const resolveConfiguredProvider = (
    model: string,
    providerId?: string
  ): AvailableProvider | null => {
    const normalizedProviderId = providerId?.trim() || '';
    if (normalizedProviderId) {
      const provider = availableProvidersWithModels.value.find(
        candidate => candidate.id === normalizedProviderId
      );
      if (!provider || !provider.models.includes(model)) {
        return null;
      }
      return provider;
    }

    for (const provider of availableProvidersWithModels.value) {
      if (provider.models.includes(model)) {
        return provider;
      }
    }

    return null;
  };

  const configuredToolModelSelection = computed<ResolvedToolModelSelection | null>(() => {
    const configuredModel = config.value.toolModel.model.trim();
    if (!configuredModel) return null;

    const configuredProvider = resolveConfiguredProvider(
      configuredModel,
      config.value.toolModel.providerId
    );
    if (!configuredProvider) return null;

    return {
      providerId: configuredProvider.id,
      providerType: configuredProvider.type,
      model: configuredModel,
    };
  });

  const configuredToolModelTestConfig = computed<ToolModelSelectionInput | null>(() => {
    const configuredModel = config.value.toolModel.model.trim();
    if (!configuredModel) return null;

    if (configuredToolModelSelection.value) {
      return configuredToolModelSelection.value;
    }

    const configuredProviderId = config.value.toolModel.providerId.trim();
    return configuredProviderId
      ? {
          providerId: configuredProviderId,
          model: configuredModel,
        }
      : {
          model: configuredModel,
        };
  });

  const selectedToolModelOptionValue = computed(() => {
    const configuredModel = config.value.toolModel.model.trim();
    if (!configuredModel) {
      return UNCONFIGURED_TOOL_MODEL_VALUE;
    }

    if (!configuredToolModelSelection.value) {
      return serializeToolModelSelection({
        providerId: config.value.toolModel.providerId.trim() || '__unresolved__',
        model: configuredModel,
      });
    }

    return serializeToolModelSelection(configuredToolModelSelection.value);
  });

  const canTestToolModel = computed(() => configuredToolModelTestConfig.value !== null);
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

  const formatTestedToolModel = (selection: ToolModelSelectionInput): string =>
    selection.providerType ? `${selection.model} (${selection.providerType})` : selection.model;

  const loadUpdateStatus = async () => {
    isLoadingUpdateStatus.value = true;
    try {
      updateStatus.value = await updateService.getStatus();
    } catch (error) {
      settingsGeneralLogger.event({
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
      settingsGeneralLogger.event({
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
      settingsGeneralLogger.event({
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

  const testToolModel = async () => {
    if (!canTestToolModel.value) return;

    const testLatency = electronAPI.toolModel?.testLatency;
    if (typeof testLatency !== 'function') {
      toolModelTestResult.value = {
        status: 'error',
        message: t('settings.general.toolModel.latencyFailed', {
          error: 'Tool model testing is unavailable',
        }),
      };
      return;
    }

    isTestingModel.value = true;
    toolModelTestResult.value = null;

    try {
      const result = await testLatency(configuredToolModelTestConfig.value);
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
        providerId: result.providerId,
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

    if (value === UNCONFIGURED_TOOL_MODEL_VALUE) {
      configStore.setToolModel({
        providerId: '',
        model: '',
      });
      params.onConfigChange();
      return;
    }

    const selection = parseToolModelSelection(value);
    if (!selection) {
      settingsGeneralLogger.event({
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
      providerId: selection.providerId || '',
      model: selection.model,
    });
    params.onConfigChange();
  };

  const updateToolExecution = <K extends keyof AppConfig['toolExecution']>(
    key: K,
    value: AppConfig['toolExecution'][K]
  ) => {
    configStore.updateToolExecution(key, value);
    params.onConfigChange();
  };

  const updateShellApprovalMode = (value: string) => {
    if (value === 'always') {
      updateToolExecution('shellApprovalMode', value);
    }
  };

  const formatGeneralLabel = (key: string): string => {
    const translatedLabels: Record<string, string> = {
      startMinimized: t('settings.general.startMinimized'),
      minimizeToTray: t('settings.general.minimizeToTray'),
      closeToTray: t('settings.general.closeToTray'),
      autoUpdate: t('settings.general.autoUpdate'),
      quickChatHideOnBlur: t('settings.general.quickChatHideOnBlur'),
    };

    return translatedLabels[key] || formatLabel(key);
  };

  const updateGeneral = <K extends keyof AppConfig['general']>(
    key: K,
    value: AppConfig['general'][K]
  ) => {
    configStore.updateGeneral(key, value);
    params.onConfigChange();
  };

  const updateLanguageSelection = (value: string) => {
    if (value === 'en' || value === 'zh-CN') {
      updateGeneral('language', value);
    }
  };

  const toggleAutoApproveToolRequests = () => {
    updateGeneral('autoApproveToolRequests', !config.value.general.autoApproveToolRequests);
  };

  let removeUpdateStatusListener: () => void = () => undefined;

  onMounted(async () => {
    removeUpdateStatusListener = updateService.onStatusChanged(status => {
      updateStatus.value = status;
      isLoadingUpdateStatus.value = false;
    });
    await loadUpdateStatus();
  });

  onBeforeUnmount(() => {
    removeUpdateStatusListener();
  });

  return {
    canCheckForUpdates,
    canInstallDownloadedUpdate,
    canTestToolModel,
    checkForUpdatesNow,
    config,
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
    updateGeneral,
    updateLanguageSelection,
    updateShellApprovalMode,
    updateStatus,
    updateStatusDescription,
    updateStatusMeta,
    updateStatusTitle,
    updateStatusTone,
    updateToolModelSelection,
  };
};
