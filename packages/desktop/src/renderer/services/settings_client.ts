import { inject, provide, type InjectionKey } from 'vue';

import type {
  AppConfig,
  ConfigRuntimeInfo,
  NetworkDiagnosticResult,
} from '@iki/core/types/config';
import type { ChatUsagePeriod, ChatUsageSummary } from '@iki/core/types/chat_usage';
import type { DevRuntimeStatus } from '@iki/core/types/devtools';
import type {
  McpServer,
  McpServerInput,
  McpServerStatus,
  McpServerSummary,
  McpToolCatalogItem,
} from '@iki/core/types/mcp';
import type {
  Provider,
  ProviderModelDescriptor,
  ProviderModelDiscoveryOverride,
  ProviderUpdatedEvent,
} from '@iki/core/types/provider';
import type { SkillSource, SkillSummary } from '@iki/core/types/skill';
import type {
  SpeechStatus,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '@iki/core/types/speech';
import type { AppUpdateStatus } from '@iki/core/types/update';
import { configService } from './config_service';
import { getOptionalElectronAPI } from './electron_api';
import { updateService } from './update_service';

type ActionResult = {
  success: boolean;
  error?: string;
  path?: string;
};

type SkillReadResult = ActionResult & {
  id?: string;
  name?: string;
  source?: SkillSource;
  filePath?: string;
  content?: string;
  truncated?: boolean;
};

type SkillRootEntry = {
  source: SkillSource;
  path: string;
};

type ToolModelLatencyInput = {
  providerId?: string;
  providerType?: string;
  model: string;
};

type ToolModelLatencyResult = {
  success: boolean;
  providerId?: string;
  providerType?: string;
  model?: string;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Platform-neutral backend contract for Settings UI components.
 * Electron shells bind IPC implementations via `createElectronSettingsClient()`;
 * Web shells in the same monorepo can inject an HTTP/WS implementation without
 * touching any Vue component or composable inside `settings/`.
 */
export interface SettingsClient {
  config: {
    get: () => Promise<AppConfig>;
    set: (config: AppConfig) => Promise<unknown>;
    getRuntimeInfo: () => Promise<ConfigRuntimeInfo>;
    testNetwork: (network: AppConfig['network']) => Promise<NetworkDiagnosticResult>;
    onUpdated: (callback: (config: AppConfig) => void) => () => void;
  };
  providers: {
    list: () => Promise<Provider[]>;
    add: (provider: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type' | 'apiKey' | 'models'>) => Promise<Provider>;
    update: (id: string, provider: Partial<Provider>) => Promise<Provider | null>;
    delete: (id: string) => Promise<void>;
    onUpdated: (callback: (event: ProviderUpdatedEvent) => void) => () => void;
    listModels: (
      providerType: string,
      providerId?: string,
      providerOverride?: ProviderModelDiscoveryOverride | null
    ) => Promise<ProviderModelDescriptor[]>;
  };
  toolModel: {
    testLatency?: (config?: ToolModelLatencyInput | null) => Promise<ToolModelLatencyResult>;
  };
  mcp: {
    list?: () => Promise<McpServerSummary[]>;
    add?: (input: McpServerInput) => Promise<McpServer>;
    update?: (id: string, updates: Partial<McpServerInput>) => Promise<McpServer>;
    delete?: (id: string) => Promise<ActionResult>;
    connect?: (id: string) => Promise<McpServerStatus>;
    disconnect?: (id: string) => Promise<ActionResult>;
    refreshTools?: (id: string) => Promise<McpToolCatalogItem[]>;
  };
  speech: {
    getStatus?: () => Promise<SpeechStatus>;
    listModels?: () => Promise<WhisperNodeModelInfo[]>;
    downloadModel?: (modelName: string) => Promise<WhisperNodeDownloadResult>;
    onDownloadProgress?: (callback: (payload: WhisperNodeDownloadProgress) => void) => () => void;
  };
  skills: {
    list?: () => Promise<SkillSummary[]>;
    roots?: () => Promise<SkillRootEntry[]>;
    openRoot?: (source?: SkillSource) => Promise<ActionResult>;
    openSkill?: (id: string) => Promise<ActionResult>;
    read?: (id: string, options?: { maxChars?: number }) => Promise<SkillReadResult>;
  };
  usage: {
    getSummary?: (period?: ChatUsagePeriod) => Promise<ChatUsageSummary>;
  };
  updates: {
    getStatus: () => Promise<AppUpdateStatus>;
    check: () => Promise<AppUpdateStatus>;
    install: () => Promise<void>;
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) => () => void;
  };
  dev: {
    getStatus: () => Promise<DevRuntimeStatus>;
    restartApp: () => Promise<{ ok: boolean; reason?: string }>;
  };
}

const SETTINGS_CLIENT_KEY: InjectionKey<SettingsClient> = Symbol('SettingsClient');

export const createElectronSettingsClient = (): SettingsClient => {
  const api = getOptionalElectronAPI();
  return {
    config: configService,
    providers: {
      list: async () => (api ? api.providers.list() : []),
      add: async provider => {
        if (!api) throw new Error('providers.add is unavailable');
        return api.providers.add(provider);
      },
      update: async (id, provider) => {
        if (!api) throw new Error('providers.update is unavailable');
        return api.providers.update(id, provider);
      },
      delete: async id => {
        if (!api) throw new Error('providers.delete is unavailable');
        return api.providers.delete(id);
      },
      onUpdated: callback =>
        typeof api?.providers?.onUpdated === 'function'
          ? api.providers.onUpdated(callback)
          : () => undefined,
      listModels: async (providerType, providerId, providerOverride) => {
        if (!api) return [];
        return api.chat.getModels(providerType, providerId, providerOverride);
      },
    },
    toolModel: {
      testLatency: api?.toolModel?.testLatency
        ? config => api.toolModel.testLatency(config)
        : undefined,
    },
    mcp: api?.mcp ?? {},
    speech: api?.speech ?? {},
    skills: api?.skills ?? {},
    usage: {
      getSummary: api?.chat?.usage?.summary
        ? period => api.chat.usage.summary(period)
        : undefined,
    },
    updates: updateService,
    dev: {
      getStatus: async () =>
        api?.dev?.getStatus
          ? api.dev.getStatus()
          : {
              available: false,
              hotReload: false,
              isPackaged: true,
              appVersion: '',
              appPath: '',
            },
      restartApp: async () =>
        api?.dev?.restartApp ? api.dev.restartApp() : { ok: false, reason: 'unavailable' },
    },
  };
};

export const provideSettingsClient = (client: SettingsClient): void => {
  provide(SETTINGS_CLIENT_KEY, client);
};

export const useSettingsClient = (): SettingsClient => {
  return inject(SETTINGS_CLIENT_KEY, () => createElectronSettingsClient(), true);
};
