import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../i18n';
import { configService } from '../services/config_service';
import { useConfigStore } from '../store/config';
import { getElectronApiSliceMethod } from '../services/electron_api';
import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonLogsInfo,
  DaemonStatusInfo,
  NapCatMessagePreviewEntry,
} from '../../shared/types/config';
import type { Provider } from '../../shared/types/provider';
import {
  buildNapCatWsUrl,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
} from '../../shared/constants/daemon';
import {
  formatStructuredConsoleLine,
  type StructuredConsoleFormatterInput,
} from '../../shared/logging/console_formatter';
import { getErrorMessage } from '../../shared/utils/errors';
import { parseModelList } from '../../shared/utils/provider_models';
import { getProviderDisplayName } from '../modules/providers/provider_display';

type ProviderOption = {
  type: string;
  label: string;
  models: string[];
  duplicateCount: number;
};

const MONITORING_POLL_MS = 5000;

export const useNapCatSettings = (params: {
  active: Readonly<Ref<boolean>>;
  onConfigChange: () => void;
}) => {
  const { t } = useI18n();
  const listProviders = getElectronApiSliceMethod('providers', 'list');

  const configStore = useConfigStore();
  const { config } = storeToRefs(configStore);

  const providers = ref<Provider[]>([]);
  const providersLoading = ref(false);
  const providersError = ref('');
  const runtimeInfo = ref<ConfigRuntimeInfo | null>(null);
  const runtimeInfoError = ref('');
  const daemonStatus = ref<DaemonStatusInfo | null>(null);
  const daemonStatusLoading = ref(false);
  const daemonStatusError = ref('');
  const daemonLogs = ref<DaemonLogsInfo | null>(null);
  const daemonLogsLoading = ref(false);
  const daemonLogsError = ref('');
  const daemonControlLoading = ref(false);
  const daemonControlMessage = ref('');
  const daemonControlSuccess = ref<boolean | null>(null);
  let monitoringPollTimer: ReturnType<typeof setInterval> | null = null;

  const napcat = computed(() => config.value.bridges.napcat);
  const accessToken = computed(() => napcat.value.accessToken.trim());

  const daemonHost = computed(() => {
    const host = config.value.daemon?.host;
    if (typeof host !== 'string' || !host.trim()) return DEFAULT_DAEMON_HOST;
    return host.trim();
  });

  const daemonPort = computed(() => {
    const port = Number(config.value.daemon?.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return DEFAULT_DAEMON_PORT;
    return Math.trunc(port);
  });

  const providerOptions = computed<ProviderOption[]>(() => {
    const byType = new Map<string, ProviderOption>();

    for (const provider of providers.value) {
      if (!provider.enabled) continue;
      const type = provider.type?.trim();
      if (!type) continue;

      const models = parseModelList(provider.models);
      if (models.length === 0) continue;

      const existing = byType.get(type);
      if (existing) {
        existing.duplicateCount += 1;
        continue;
      }

      byType.set(type, {
        type,
        label: `${getProviderDisplayName(provider)} (${type})`,
        models,
        duplicateCount: 1,
      });
    }

    return Array.from(byType.values()).sort((a, b) => a.label.localeCompare(b.label));
  });

  const napCatProviderTypeOptions = computed(() => [
    { value: '', label: t('settings.napcat.providerAuto') },
    ...providerOptions.value.map(provider => ({
      value: provider.type,
      label: provider.label,
    })),
  ]);

  const selectedProviderOption = computed(() => {
    const providerType = napcat.value.providerType?.trim();
    if (!providerType) return null;
    return providerOptions.value.find(option => option.type === providerType) || null;
  });

  const selectedProviderModels = computed(() => selectedProviderOption.value?.models || []);

  const hasDuplicateProviderType = computed(() =>
    providerOptions.value.some(option => option.duplicateCount > 1)
  );

  const toolListText = computed(() => napcat.value.tools.join('\n'));

  const providerSummary = computed(() => {
    const providerType = napcat.value.providerType?.trim();
    const model = napcat.value.model?.trim();

    if (!providerType && !model) return t('settings.napcat.providerSummary.auto');
    if (providerType && model) {
      return t('settings.napcat.providerSummary.providerAndModel', {
        provider: providerType,
        model,
      });
    }
    if (providerType) {
      return t('settings.napcat.providerSummary.providerOnly', {
        provider: providerType,
      });
    }
    return t('settings.napcat.providerSummary.modelOnly', { model });
  });

  const toolSummary = computed(() => {
    return napcat.value.tools.length > 0
      ? napcat.value.tools.join(', ')
      : t('settings.napcat.toolsDisabled');
  });

  const configPathSummary = computed(() => runtimeInfo.value?.dbPath || t('common.unavailable'));

  const daemonStatusChip = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.daemonChecking');
    if (daemonStatus.value?.online) return t('settings.napcat.daemonOnline');
    return t('settings.napcat.daemonOffline');
  });

  const daemonStatusClass = computed(() => ({
    active: Boolean(daemonStatus.value?.online),
  }));

  const formatDaemonSourceLabel = (source: DaemonStatusInfo['source']): string => {
    if (source === 'health') return t('settings.napcat.daemonSource.health');
    if (source === 'recorded') return t('settings.napcat.daemonSource.recorded');
    return t('settings.napcat.daemonSource.default');
  };

  const daemonStatusDetail = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.daemonCheckingDetail');
    if (daemonStatusError.value) return daemonStatusError.value;
    if (!daemonStatus.value) return t('settings.napcat.daemonUnavailable');
    if (daemonStatus.value.online && daemonStatus.value.uptimeSeconds !== null) {
      return t('settings.napcat.daemonUptime', {
        seconds: daemonStatus.value.uptimeSeconds.toFixed(0),
      });
    }
    if (daemonStatus.value.error) return daemonStatus.value.error;
    return t('settings.napcat.daemonSource', {
      source: formatDaemonSourceLabel(daemonStatus.value.source),
    });
  });

  const activeDaemonHost = computed(() => daemonStatus.value?.host || daemonHost.value);
  const activeDaemonPort = computed(() => daemonStatus.value?.port || daemonPort.value);
  const activeDaemonAddress = computed(() => `${activeDaemonHost.value}:${activeDaemonPort.value}`);
  const daemonLogPath = computed(() => daemonLogs.value?.filePath || t('common.unavailable'));

  const daemonLogCount = computed(() => {
    if (daemonLogsLoading.value) return t('settings.napcat.loadingCount');
    return String(daemonLogs.value?.entries.length || 0);
  });

  const formatStructuredLogViewLine = (input: StructuredConsoleFormatterInput) =>
    formatStructuredConsoleLine(input, { colorize: false });

  const toFormattedDaemonLogLine = (entry: NonNullable<DaemonLogsInfo['entries']>[number]) =>
    formatStructuredLogViewLine({
      ts: entry.ts || entry.timestamp,
      level: entry.level,
      process: entry.process || 'daemon',
      module: entry.module || entry.source || 'daemon',
      event: entry.event || 'legacy.log',
      ...(entry.outcome ? { outcome: entry.outcome } : {}),
      ...(entry.message ? { message: entry.message } : {}),
      ...(entry.trace_id ? { trace_id: entry.trace_id } : {}),
      ...(entry.request_id ? { request_id: entry.request_id } : {}),
      ...(entry.session_id ? { session_id: entry.session_id } : {}),
      ...(typeof entry.duration_ms === 'number' ? { duration_ms: entry.duration_ms } : {}),
      ...(entry.entity ? { entity: entry.entity } : {}),
      ...(entry.data ? { data: entry.data } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    });

  const normalizeNapCatPreviewFromLogEntry = (
    entry: NonNullable<DaemonLogsInfo['entries']>[number]
  ): NapCatMessagePreviewEntry | null => {
    if (entry.event !== 'napcat.message.received') return null;

    const data = entry.data || {};
    const messageType =
      data.message_type === 'group'
        ? 'group'
        : data.message_type === 'private'
          ? 'private'
          : null;
    const textPreview = typeof data.text_preview === 'string' ? data.text_preview.trim() : '';
    const userId =
      typeof data.user_id === 'string'
        ? data.user_id.trim()
        : typeof data.user_id === 'number'
          ? String(data.user_id)
          : '';

    if (!messageType || !textPreview || !userId) return null;

    return {
      receivedAt: entry.ts || entry.timestamp,
      messageType,
      userId,
      ...(typeof data.group_id === 'string' || typeof data.group_id === 'number'
        ? { groupId: String(data.group_id) }
        : {}),
      ...(typeof data.self_id === 'string' || typeof data.self_id === 'number'
        ? { selfId: String(data.self_id) }
        : {}),
      ...(typeof data.message_id === 'string' || typeof data.message_id === 'number'
        ? { messageId: String(data.message_id) }
        : {}),
      textPreview,
      mentionedSelf: Boolean(data.mentioned_self),
      replyEligible: Boolean(data.reply_eligible),
    };
  };

  const napcatMessagePreviews = computed(() => {
    const explicit = Array.isArray(daemonLogs.value?.napcatMessages)
      ? daemonLogs.value?.napcatMessages
      : [];
    const entries =
      explicit && explicit.length > 0
        ? explicit
        : (daemonLogs.value?.entries || [])
            .map(normalizeNapCatPreviewFromLogEntry)
            .filter((entry): entry is NapCatMessagePreviewEntry => Boolean(entry));

    return [...entries].reverse();
  });

  const napcatMessagePreviewCount = computed(() => {
    if (daemonLogsLoading.value) return t('settings.napcat.loadingCount');
    return String(napcatMessagePreviews.value.length);
  });

  const formatNapCatPreviewLine = (entry: NapCatMessagePreviewEntry) => {
    return formatStructuredLogViewLine({
      ts: entry.receivedAt,
      level: 'info',
      process: 'daemon',
      module: 'napcat',
      event: 'napcat.message.received',
      ...(entry.replyEligible ? {} : { outcome: 'skipped' }),
      message: entry.textPreview,
      data: {
        message_type: entry.messageType,
        user_id: entry.userId,
        ...(entry.groupId ? { group_id: entry.groupId } : {}),
        ...(entry.selfId ? { self_id: entry.selfId } : {}),
        ...(entry.messageId ? { message_id: entry.messageId } : {}),
        mentioned_self: entry.mentionedSelf,
        reply_eligible: entry.replyEligible,
      },
    });
  };

  const daemonLogText = computed(() => {
    if (daemonLogsLoading.value) return t('settings.napcat.loadingLogs');
    if (daemonLogsError.value) return daemonLogsError.value;

    const sections: string[] = [];

    if (napcatMessagePreviews.value.length > 0) {
      sections.push(t('settings.napcat.recentQqMessages'));
      sections.push(...napcatMessagePreviews.value.map(formatNapCatPreviewLine));
    }

    const entries = daemonLogs.value?.entries || [];
    if (entries.length > 0) {
      if (sections.length > 0) sections.push('');
      sections.push(t('settings.napcat.recentLogs'));
      sections.push(...entries.map(toFormattedDaemonLogLine));
    }

    if (sections.length === 0) return t('settings.napcat.noLogs');
    return sections.join('\n');
  });

  const localWsUrl = computed(() =>
    buildNapCatWsUrl(activeDaemonHost.value, activeDaemonPort.value, accessToken.value)
  );

  const dockerWsUrl = computed(() =>
    buildNapCatWsUrl('host.docker.internal', activeDaemonPort.value, accessToken.value)
  );

  const updateNapCat = <K extends keyof AppConfig['bridges']['napcat']>(
    key: K,
    value: AppConfig['bridges']['napcat'][K]
  ) => {
    config.value.bridges.napcat[key] = value;
    params.onConfigChange();
  };

  const updateNapCatProviderTypeSelection = (value: string) => {
    updateNapCat('providerType', value);
  };

  const updateDaemonHost = (value: string) => {
    config.value.daemon.host = value;
    params.onConfigChange();
  };

  const updateDaemonPort = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      config.value.daemon.port = DEFAULT_DAEMON_PORT;
      params.onConfigChange();
      return;
    }
    config.value.daemon.port = Math.trunc(parsed);
    params.onConfigChange();
  };

  const updateTools = (value: string) => {
    const tools = value
      .split(/[\r\n,]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter((item, index, items) => items.indexOf(item) === index);
    updateNapCat('tools', tools);
  };

  const loadProviders = async () => {
    providersLoading.value = true;
    providersError.value = '';
    try {
      if (!listProviders) {
        providers.value = [];
        providersError.value = t('settings.napcat.error.providerApiUnavailable');
        return;
      }
      const list = await listProviders();
      providers.value = Array.isArray(list) ? (list as Provider[]) : [];
    } catch (error: unknown) {
      providers.value = [];
      providersError.value = getErrorMessage(error);
    } finally {
      providersLoading.value = false;
    }
  };

  const loadRuntimeInfo = async () => {
    runtimeInfoError.value = '';
    try {
      runtimeInfo.value = await configService.getRuntimeInfo();
    } catch (error: unknown) {
      runtimeInfo.value = null;
      runtimeInfoError.value = getErrorMessage(error);
    }
  };

  const loadDaemonStatus = async () => {
    if (daemonStatusLoading.value) return;
    daemonStatusLoading.value = true;
    daemonStatusError.value = '';
    try {
      daemonStatus.value = await configService.getDaemonStatus();
    } catch (error: unknown) {
      daemonStatus.value = null;
      daemonStatusError.value = getErrorMessage(error);
    } finally {
      daemonStatusLoading.value = false;
    }
  };

  const loadDaemonLogs = async () => {
    if (daemonLogsLoading.value) return;
    daemonLogsLoading.value = true;
    daemonLogsError.value = '';
    try {
      daemonLogs.value = await configService.getDaemonLogs(120);
    } catch (error: unknown) {
      daemonLogs.value = null;
      daemonLogsError.value = getErrorMessage(error);
    } finally {
      daemonLogsLoading.value = false;
    }
  };

  const handleDaemonControl = async (action: DaemonControlAction) => {
    if (daemonControlLoading.value) return;
    daemonControlLoading.value = true;
    daemonControlMessage.value = '';
    daemonControlSuccess.value = null;

    try {
      const result = await configService.controlDaemon(action);
      daemonStatus.value = result.status;
      daemonControlSuccess.value = result.success;
      daemonControlMessage.value = result.message;
      await loadDaemonLogs();
    } catch (error: unknown) {
      daemonControlSuccess.value = false;
      daemonControlMessage.value = getErrorMessage(error);
    } finally {
      daemonControlLoading.value = false;
    }
  };

  const refreshMonitoring = () => {
    void loadDaemonStatus();
    void loadDaemonLogs();
  };

  const stopMonitoringPoll = () => {
    if (monitoringPollTimer === null) return;
    clearInterval(monitoringPollTimer);
    monitoringPollTimer = null;
  };

  const startMonitoringPoll = () => {
    if (monitoringPollTimer !== null) return;
    monitoringPollTimer = setInterval(() => {
      refreshMonitoring();
    }, MONITORING_POLL_MS);
  };

  watch(
    () => params.active.value,
    active => {
      if (active) {
        void loadProviders();
        void loadRuntimeInfo();
        refreshMonitoring();
        startMonitoringPoll();
        return;
      }
      stopMonitoringPoll();
    },
    { immediate: true }
  );

  onUnmounted(() => {
    stopMonitoringPoll();
  });

  return {
    activeDaemonAddress,
    configPathSummary,
    daemonControlLoading,
    daemonControlMessage,
    daemonControlSuccess,
    daemonHost,
    daemonLogCount,
    daemonLogPath,
    daemonLogText,
    daemonLogsError,
    daemonPort,
    daemonStatusChip,
    daemonStatusClass,
    daemonStatusDetail,
    dockerWsUrl,
    handleDaemonControl,
    hasDuplicateProviderType,
    loadDaemonLogs,
    loadDaemonStatus,
    localWsUrl,
    napCatProviderTypeOptions,
    napcat,
    napcatMessagePreviewCount,
    providerOptions,
    providerSummary,
    providersError,
    providersLoading,
    runtimeInfoError,
    selectedProviderModels,
    t,
    toolListText,
    toolSummary,
    updateDaemonHost,
    updateDaemonPort,
    updateNapCat,
    updateNapCatProviderTypeSelection,
    updateTools,
  };
};
