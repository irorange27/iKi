import * as providerDb from '@iki/backend/db/providers';
import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { parseModelList } from '@iki/backend/utils/provider_models';
import type {
  CompanionDormantReason,
  CompanionPhase,
  CompanionSnapshot,
  ConversationPreview,
} from '@iki/backend/types/companion';
import type { AppConfig } from '@iki/backend/types/config';
import type { Provider } from '@iki/backend/types/provider';
import { getAllBrowserWindows } from '../../utils/browser_windows';

type CompanionWindowTarget = {
  webContents: {
    send: (channel: string, payload: CompanionSnapshot) => void;
  };
};

type CompanionServiceDeps = {
  getConfig?: () => Partial<AppConfig>;
  listProviders?: () => Provider[];
  listWindows?: () => CompanionWindowTarget[];
  now?: () => Date;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

type TimedNudgeState = {
  taskName: string;
  expiresAt: number;
};

const companionLogger = createLogger({ module: 'companion_service' });

const COMPANION_UPDATED_CHANNEL = 'companion:updated';
const NUDGE_TTL_MS = 12_000;

const COMPANION_COPY = {
  en: {
    dormant: {
      label: 'Dormant',
      providerHeadline: 'Need a provider',
      providerDetail: 'Connect one enabled provider.',
      modelHeadline: 'Need a model',
      modelDetail: 'Pick one usable model to wake iKi.',
    },
    idle: {
      label: 'Ready',
      headline: 'Here',
      detail: 'Waiting for the next turn.',
    },
    thinking: {
      label: 'Thinking',
      headline: 'Reading',
      detail: 'Gathering context.',
    },
    nudge: {
      replyLabel: 'Reply ready',
      replyDetail: 'The reply is complete.',
    },
  },
  'zh-CN': {
    dormant: {
      label: '休眠',
      providerHeadline: '需要 Provider',
      providerDetail: '先接入一个已启用 Provider。',
      modelHeadline: '需要模型',
      modelDetail: '选一个可用模型，iKi 才会醒来。',
    },
    idle: {
      label: '待命',
      headline: '在这儿',
      detail: '等你下一步。',
    },
    thinking: {
      label: '思考中',
      headline: '先读一下',
      detail: '正在汇聚上下文。',
    },
    nudge: {
      replyLabel: '回复完成',
      replyDetail: 'AI 已完成回复。',
    },
  },
} as const;

const createSnapshot = (
  phase: CompanionPhase,
  params: {
    label: string;
    headline: string;
    detail: string;
    updatedAt: string;
    dormantReason?: CompanionDormantReason;
  }
): CompanionSnapshot => ({
  phase,
  label: params.label,
  headline: params.headline,
  detail: params.detail,
  updatedAt: params.updatedAt,
  ...(params.dormantReason ? { dormantReason: params.dormantReason } : {}),
});

const isEnabledProvider = (provider: Provider): boolean => provider.enabled === true;

const hasAnyConfiguredModel = (provider: Provider): boolean =>
  parseModelList(provider.models).length > 0 ||
  parseModelList(provider.available_models).length > 0;

const resolveDormantReason = (providers: Provider[]): CompanionDormantReason | null => {
  const enabledProviders = providers.filter(isEnabledProvider);
  if (enabledProviders.length === 0) {
    return 'provider_missing';
  }
  if (!enabledProviders.some(hasAnyConfiguredModel)) {
    return 'model_missing';
  }
  return null;
};

const clipTaskName = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.length > 44 ? `${trimmed.slice(0, 41).trimEnd()}...` : trimmed;
};

const resolveLanguage = (config?: Partial<AppConfig> | null): keyof typeof COMPANION_COPY =>
  config?.general?.language === 'zh-CN' ? 'zh-CN' : 'en';

const buildNudgeSnapshot = (
  updatedAt: string,
  params: {
    copy: (typeof COMPANION_COPY)[keyof typeof COMPANION_COPY];
    taskName: string;
  }
): CompanionSnapshot => {
  const clipped = clipTaskName(params.taskName, '');
  const detail = clipped
    ? `${params.copy.nudge.replyDetail} — ${clipped}`
    : params.copy.nudge.replyDetail;
  return createSnapshot('nudge', {
    label: params.copy.nudge.replyLabel,
    headline: params.copy.nudge.replyLabel,
    detail,
    updatedAt,
  });
};

const isExpired = (expiresAt: number, nowMs: number): boolean => nowMs >= expiresAt;

const snapshotsEqual = (left: CompanionSnapshot, right: CompanionSnapshot): boolean =>
  left.phase === right.phase &&
  left.label === right.label &&
  left.headline === right.headline &&
  left.detail === right.detail &&
  left.dormantReason === right.dormantReason &&
  left.preview?.kind === right.preview?.kind &&
  left.preview?.text === right.preview?.text &&
  left.preview?.toolName === right.preview?.toolName &&
  left.preview?.threadId === right.preview?.threadId;

export const createCompanionService = (deps: CompanionServiceDeps = {}) => {
  const getConfig = deps.getConfig ?? getAppConfig;
  const listProviders = deps.listProviders ?? providerDb.getProviders;
  const listWindows = deps.listWindows ?? getAllBrowserWindows;
  const now = deps.now ?? (() => new Date());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;

  const THINKING_KEY_TTL_MS = 300_000;
  const thinkingKeys = new Map<string, number>();
  const clearExpiredThinkingKeys = () => {
    const nowMs = now().getTime();
    for (const [key, timestamp] of thinkingKeys) {
      if (nowMs - timestamp >= THINKING_KEY_TTL_MS) {
        thinkingKeys.delete(key);
      }
    }
  };
  let timedNudgeState: TimedNudgeState | null = null;
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  let currentSnapshot = createSnapshot('idle', {
    label: COMPANION_COPY.en.idle.label,
    headline: COMPANION_COPY.en.idle.headline,
    detail: COMPANION_COPY.en.idle.detail,
    updatedAt: now().toISOString(),
  });
  let currentPreview: ConversationPreview | null = null;

  const clearExpiredState = () => {
    const nowMs = now().getTime();
    if (timedNudgeState && isExpired(timedNudgeState.expiresAt, nowMs)) {
      timedNudgeState = null;
    }
  };

  const scheduleNudgeExpiry = () => {
    if (nudgeTimer) {
      clearTimeoutFn(nudgeTimer);
      nudgeTimer = null;
    }
    if (!timedNudgeState) return;

    const delay = Math.max(0, timedNudgeState.expiresAt - now().getTime());
    nudgeTimer = setTimeoutFn(() => {
      timedNudgeState = null;
      nudgeTimer = null;
      publish();
    }, delay);
  };

  const deriveSnapshot = (): CompanionSnapshot => {
    clearExpiredState();
    clearExpiredThinkingKeys();

    const updatedAt = now().toISOString();
    const config = getConfig();
    const copy = COMPANION_COPY[resolveLanguage(config)];
    const dormantReason = resolveDormantReason(listProviders());
    if (dormantReason) {
      if (dormantReason === 'model_missing') {
        return createSnapshot('dormant', {
          label: copy.dormant.label,
          headline: copy.dormant.modelHeadline,
          detail: copy.dormant.modelDetail,
          updatedAt,
          dormantReason,
        });
      }
      return createSnapshot('dormant', {
        label: copy.dormant.label,
        headline: copy.dormant.providerHeadline,
        detail: copy.dormant.providerDetail,
        updatedAt,
        dormantReason,
      });
    }

    if (timedNudgeState) {
      return buildNudgeSnapshot(updatedAt, {
        copy,
        ...timedNudgeState,
      });
    }

    if (thinkingKeys.size > 0) {
      return createSnapshot('thinking', {
        label: copy.thinking.label,
        headline: copy.thinking.headline,
        detail: copy.thinking.detail,
        updatedAt,
      });
    }

    return createSnapshot('idle', {
      label: copy.idle.label,
      headline: copy.idle.headline,
      detail: copy.idle.detail,
      updatedAt,
    });
  };

  const broadcast = (snapshot: CompanionSnapshot) => {
    const windows = listWindows();
    for (const win of windows) {
      try {
        win.webContents.send(COMPANION_UPDATED_CHANNEL, snapshot);
      } catch (error) {
        companionLogger.event({
          level: 'warn',
          event: 'companion.broadcast',
          outcome: 'degraded',
          error,
          message: 'Failed to push companion snapshot to renderer.',
        });
      }
    }
  };

  const publish = (): CompanionSnapshot => {
    const nextSnapshot = deriveSnapshot();
    if (snapshotsEqual(nextSnapshot, currentSnapshot)) {
      return currentSnapshot;
    }
    currentSnapshot = nextSnapshot;
    broadcast(currentSnapshot);
    return currentSnapshot;
  };

  return {
    getSnapshot: (): CompanionSnapshot => publish(),
    refreshAvailability: (): CompanionSnapshot => publish(),
    beginThinking: (key: string): CompanionSnapshot => {
      const trimmedKey = key.trim();
      if (!trimmedKey) return publish();
      thinkingKeys.set(trimmedKey, now().getTime());
      return publish();
    },
    endThinking: (key: string): CompanionSnapshot => {
      const trimmedKey = key.trim();
      if (!trimmedKey) return publish();
      thinkingKeys.delete(trimmedKey);
      return publish();
    },
    notifyReplyComplete: (threadLabel?: string): CompanionSnapshot => {
      const label = threadLabel?.trim() || '';
      timedNudgeState = {
        taskName: label,
        expiresAt: now().getTime() + NUDGE_TTL_MS,
      };
      scheduleNudgeExpiry();
      return publish();
    },
    setConversationPreview: (preview: ConversationPreview): void => {
      currentPreview = preview;
      currentSnapshot = { ...currentSnapshot, preview };
      broadcast(currentSnapshot);
    },
    clearConversationPreview: (): void => {
      if (!currentPreview) return;
      currentPreview = null;
      const { preview, ...withoutPreview } = currentSnapshot;
      void preview;
      currentSnapshot = withoutPreview as CompanionSnapshot;
      broadcast(currentSnapshot);
    },
  };
};

export type CompanionService = ReturnType<typeof createCompanionService>;

export const companionService = createCompanionService();
