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
} from '@iki/backend/types/config';
import type { Provider } from '@iki/core/types/provider';
import {
  buildNapCatWsUrl,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
} from '@iki/backend/constants/daemon';
import {
  formatStructuredConsoleLine,
  type StructuredConsoleFormatterInput,
} from '@iki/core/logging/console_formatter';
import { getErrorMessage } from '@iki/core/utils/errors';
import { parseModelList } from '@iki/core/utils/provider_models';
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
  const napcatBridgeStatus = computed(() => daemonStatus.value?.bridges?.napcat || null);
  const hasNapCatBridgeRuntime = computed(() => Boolean(napcatBridgeStatus.value));
  const napcatHeartbeat = computed(() => napcatBridgeStatus.value?.heartbeat || null);
  const lastNapCatConnectedAt = computed(() => {
    const value = napcatBridgeStatus.value?.lastConnectedAt;
    return typeof value === 'string' && value.trim() ? value : null;
  });
  const lastNapCatDisconnectedAt = computed(() => {
    const value = napcatBridgeStatus.value?.lastDisconnectedAt;
    return typeof value === 'string' && value.trim() ? value : null;
  });
  const activeNapCatConnectionCount = computed(() => {
    const count = napcatBridgeStatus.value?.activeConnectionCount;
    return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null;
  });
  const hasActiveNapCatTransport = computed(() => (activeNapCatConnectionCount.value || 0) > 0);

  const formatDurationMs = (value: number | null): string => {
    if (value === null || !Number.isFinite(value) || value < 0) return t('common.unavailable');
    if (value < 1000) return `${Math.round(value)}ms`;

    const seconds = value / 1000;
    if (seconds < 60) {
      return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`;
    }

    const minutes = seconds / 60;
    if (minutes < 60) return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)}m`;

    const hours = minutes / 60;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h`;
  };

  const formatHistoricalAge = (value: string | null): string | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    return formatDurationMs(Math.max(0, Date.now() - parsed));
  };

  const summarizeHistoricalTimestamp = (
    value: string | null,
    emptyKey: 'settings.napcat.lastConnectedNever' | 'settings.napcat.lastDisconnectedNever'
  ): string => {
    if (!value) return t(emptyKey);
    const age = formatHistoricalAge(value);
    if (!age) return value;
    return t('settings.napcat.lastConnectionValue', { age });
  };

  const daemonStatusChip = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.daemonChecking');
    if (daemonStatus.value?.online) return t('settings.napcat.daemonOnline');
    return t('settings.napcat.daemonOffline');
  });

  const daemonStatusClass = computed(() => ({
    active: Boolean(daemonStatus.value?.online),
  }));

  const transportStatusChip = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.transportChecking');
    if (daemonStatus.value && !daemonStatus.value.online) {
      return t('settings.napcat.transportBlockedByDaemon');
    }
    if (!hasNapCatBridgeRuntime.value) {
      return t('settings.napcat.transportUnavailable');
    }

    const state = napcatBridgeStatus.value?.state;
    if (state === 'disabled') return t('settings.napcat.transportDisabled');
    if (hasActiveNapCatTransport.value) return t('settings.napcat.transportConnected');
    if (state === 'disconnected') {
      return lastNapCatConnectedAt.value || lastNapCatDisconnectedAt.value
        ? t('settings.napcat.transportDisconnected')
        : t('settings.napcat.transportWaiting');
    }
    return t('settings.napcat.transportUnavailable');
  });

  const transportStatusClass = computed(() => {
    if (daemonStatus.value && !daemonStatus.value.online) {
      return {};
    }
    if (!hasNapCatBridgeRuntime.value) {
      return {
        idle: true,
      };
    }

    const state = napcatBridgeStatus.value?.state;
    return {
      active: hasActiveNapCatTransport.value,
      warning: !hasActiveNapCatTransport.value && state === 'disconnected',
      idle: state === 'disabled' || state === 'unknown' || !state,
    };
  });

  const heartbeatStatusChip = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.heartbeatChecking');
    if (daemonStatus.value && !daemonStatus.value.online) {
      return t('settings.napcat.heartbeatBlockedByDaemon');
    }
    if (!hasNapCatBridgeRuntime.value) {
      return t('settings.napcat.heartbeatUnavailable');
    }

    const state = napcatBridgeStatus.value?.state;
    if (state === 'disabled') return t('settings.napcat.heartbeatDisabled');
    if (state === 'unknown') return t('settings.napcat.heartbeatUnavailable');
    if (!hasActiveNapCatTransport.value) {
      return t('settings.napcat.heartbeatWaitingForTransport');
    }

    const heartbeat = napcatHeartbeat.value;
    if (!heartbeat?.lastReceivedAt) return t('settings.napcat.heartbeatUnobserved');
    if (heartbeat.stale) return t('settings.napcat.heartbeatStale');
    if (heartbeat.online === false || heartbeat.good === false) {
      return t('settings.napcat.heartbeatUnhealthy');
    }
    return t('settings.napcat.heartbeatHealthy');
  });

  const heartbeatStatusClass = computed(() => {
    if (daemonStatus.value && !daemonStatus.value.online) {
      return {};
    }
    if (!hasNapCatBridgeRuntime.value) {
      return {
        idle: true,
      };
    }

    const state = napcatBridgeStatus.value?.state;
    const heartbeat = napcatHeartbeat.value;
    return {
      active:
        hasActiveNapCatTransport.value &&
        Boolean(heartbeat?.lastReceivedAt) &&
        heartbeat?.stale !== true &&
        heartbeat?.online !== false &&
        heartbeat?.good !== false,
      warning:
        hasActiveNapCatTransport.value &&
        (heartbeat?.lastReceivedAt
          ? heartbeat?.stale === true || heartbeat?.online === false || heartbeat?.good === false
          : false),
      idle: state === 'disabled' || state === 'unknown',
    };
  });

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
    if (daemonStatus.value.error) {
      return daemonStatus.value.online
        ? daemonStatus.value.error
        : t('settings.napcat.daemonOfflineDetail', {
            error: daemonStatus.value.error,
          });
    }
    return t('settings.napcat.daemonSource', {
      source: formatDaemonSourceLabel(daemonStatus.value.source),
    });
  });

  const transportStatusDetail = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.transportCheckingDetail');
    if (daemonStatusError.value || !daemonStatus.value) {
      return t('settings.napcat.transportUnavailableDetail');
    }

    const state = napcatBridgeStatus.value?.state;
    if (!daemonStatus.value.online) {
      return state === 'disabled'
        ? t('settings.napcat.transportDisabledDetail')
        : t('settings.napcat.transportBlockedByDaemonDetail');
    }
    if (!hasNapCatBridgeRuntime.value) return t('settings.napcat.transportUnknownDetail');
    if (state === 'disabled') return t('settings.napcat.transportDisabledDetail');
    if (hasActiveNapCatTransport.value) return t('settings.napcat.transportConnectedDetail');
    if (state === 'disconnected') {
      const lastDisconnectedAge = formatHistoricalAge(lastNapCatDisconnectedAt.value);
      if (lastDisconnectedAge) {
        return t('settings.napcat.transportDisconnectedRecentlyDetail', {
          age: lastDisconnectedAge,
        });
      }

      const lastConnectedAge = formatHistoricalAge(lastNapCatConnectedAt.value);
      if (lastConnectedAge) {
        return t('settings.napcat.transportDisconnectedHistoricalDetail', {
          age: lastConnectedAge,
        });
      }

      return t('settings.napcat.transportDisconnectedDetail');
    }
    return t('settings.napcat.transportUnknownDetail');
  });

  const heartbeatStatusDetail = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.heartbeatCheckingDetail');
    if (daemonStatusError.value || !daemonStatus.value) {
      return t('settings.napcat.heartbeatUnavailableDetail');
    }

    const state = napcatBridgeStatus.value?.state;
    const heartbeat = napcatHeartbeat.value;
    if (!daemonStatus.value.online) {
      return state === 'disabled'
        ? t('settings.napcat.heartbeatDisabledDetail')
        : t('settings.napcat.heartbeatBlockedByDaemonDetail');
    }
    if (!hasNapCatBridgeRuntime.value) return t('settings.napcat.heartbeatUnknownDetail');
    if (state === 'disabled') return t('settings.napcat.heartbeatDisabledDetail');
    if (state === 'unknown') return t('settings.napcat.heartbeatUnknownDetail');
    if (!hasActiveNapCatTransport.value) {
      return t('settings.napcat.heartbeatWaitingForTransportDetail');
    }
    if (!heartbeat?.lastReceivedAt) return t('settings.napcat.heartbeatUnobservedDetail');
    if (heartbeat.stale) {
      return t('settings.napcat.heartbeatStaleDetail', {
        age: formatDurationMs(heartbeat.ageMs),
        interval: formatDurationMs(heartbeat.intervalMs),
      });
    }
    if (heartbeat.online === false || heartbeat.good === false) {
      return t('settings.napcat.heartbeatUnhealthyDetail');
    }
    return t('settings.napcat.heartbeatHealthyDetail');
  });

  const bridgeConnectionCount = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.loadingCount');

    const count = activeNapCatConnectionCount.value;
    if (count === null || count === undefined) return t('common.unavailable');
    return String(count);
  });

  const lastHeartbeatSummary = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.loadingCount');
    if (daemonStatusError.value || !daemonStatus.value) return t('common.unavailable');
    if (!daemonStatus.value.online) return t('common.unavailable');
    if (!hasNapCatBridgeRuntime.value) return t('common.unavailable');
    if (napcatBridgeStatus.value?.state === 'disabled') {
      return t('settings.napcat.lastHeartbeatDisabled');
    }

    const heartbeat = napcatHeartbeat.value;
    if (!heartbeat?.lastReceivedAt) return t('settings.napcat.lastHeartbeatNever');
    return t('settings.napcat.lastHeartbeatValue', {
      age: formatDurationMs(heartbeat.ageMs),
      interval: formatDurationMs(heartbeat.intervalMs),
    });
  });

  const lastConnectedSummary = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.loadingCount');
    if (daemonStatusError.value || !daemonStatus.value) return t('common.unavailable');
    if (!daemonStatus.value.online) return t('common.unavailable');
    if (!hasNapCatBridgeRuntime.value) return t('common.unavailable');
    return summarizeHistoricalTimestamp(
      lastNapCatConnectedAt.value,
      'settings.napcat.lastConnectedNever'
    );
  });

  const lastDisconnectedSummary = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.loadingCount');
    if (daemonStatusError.value || !daemonStatus.value) return t('common.unavailable');
    if (!daemonStatus.value.online) return t('common.unavailable');
    if (!hasNapCatBridgeRuntime.value) return t('common.unavailable');
    return summarizeHistoricalTimestamp(
      lastNapCatDisconnectedAt.value,
      'settings.napcat.lastDisconnectedNever'
    );
  });

  const connectionDiagnosis = computed(() => {
    if (daemonStatusLoading.value) return t('settings.napcat.connectionDiagnosis.checking');
    if (daemonStatus.value && !daemonStatus.value.online) {
      return t('settings.napcat.connectionDiagnosis.daemonOffline');
    }
    if (!hasNapCatBridgeRuntime.value) {
      return t('settings.napcat.connectionDiagnosis.bridgeUnknown');
    }
    if (napcatBridgeStatus.value?.state === 'disabled') {
      return t('settings.napcat.connectionDiagnosis.bridgeDisabled');
    }
    if (!hasActiveNapCatTransport.value) {
      const lastDisconnectedAge = formatHistoricalAge(lastNapCatDisconnectedAt.value);
      if (lastDisconnectedAge) {
        return t('settings.napcat.connectionDiagnosis.disconnected', {
          age: lastDisconnectedAge,
        });
      }

      const lastConnectedAge = formatHistoricalAge(lastNapCatConnectedAt.value);
      if (lastConnectedAge) {
        return t('settings.napcat.connectionDiagnosis.previouslyConnected', {
          age: lastConnectedAge,
        });
      }

      return t('settings.napcat.connectionDiagnosis.waitingForTransport');
    }

    const heartbeat = napcatHeartbeat.value;
    if (!heartbeat?.lastReceivedAt) {
      return t('settings.napcat.connectionDiagnosis.connectedWithoutHeartbeat');
    }
    if (heartbeat.stale) {
      return t('settings.napcat.connectionDiagnosis.connectedHeartbeatStale');
    }
    if (heartbeat.online === false || heartbeat.good === false) {
      return t('settings.napcat.connectionDiagnosis.connectedHeartbeatUnhealthy');
    }
    return t('settings.napcat.connectionDiagnosis.connected');
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
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return;
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
    bridgeConnectionCount,
    connectionDiagnosis,
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
    heartbeatStatusChip,
    heartbeatStatusClass,
    heartbeatStatusDetail,
    lastConnectedSummary,
    lastDisconnectedSummary,
    lastHeartbeatSummary,
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
    transportStatusChip,
    transportStatusClass,
    transportStatusDetail,
    updateDaemonHost,
    updateDaemonPort,
    updateNapCat,
    updateNapCatProviderTypeSelection,
    updateTools,
  };
};
