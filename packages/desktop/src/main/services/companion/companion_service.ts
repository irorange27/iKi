import * as providerDb from '@iki/backend/db/providers';
import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { parseModelList } from '@iki/core/utils/provider_models';
import type {
  CompanionAffectHint,
  CompanionDormantReason,
  CompanionNudgeKind,
  CompanionPhase,
  CompanionSnapshot,
  ConversationPreview,
} from '@iki/backend/types/companion';
import type { AppConfig } from '@iki/backend/types/config';
import type { Provider } from '@iki/core/types/provider';
import type { InterventionPolicySignal } from '@iki/backend/chat/intervention_policy';
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

type TimedPolicyState = {
  policy: InterventionPolicySignal;
  expiresAt: number;
};

type TimedNudgeState = {
  kind: CompanionNudgeKind;
  taskName: string;
  expiresAt: number;
};

const companionLogger = createLogger({ module: 'companion_service' });

const COMPANION_UPDATED_CHANNEL = 'companion:updated';
const EXECUTE_POLICY_TTL_MS = 25_000;
const REFLECTIVE_POLICY_TTL_MS = 90_000;
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
    clarify: {
      label: 'Clarify',
      headline: 'Need one detail',
      detail: 'One missing point before moving.',
    },
    coPlan: {
      label: 'Co-plan',
      headline: 'Make it smaller',
      detail: 'Ease into the next step together.',
    },
    stabilize: {
      label: 'Steady',
      headline: 'Lower the pressure',
      detail: 'Stabilize before pushing ahead.',
    },
    execute: {
      label: 'Execute',
      headline: 'Moving',
      detail: 'Concrete enough to act.',
    },
    nudge: {
      successLabel: 'Done',
      successHeadline: 'Finished',
      errorLabel: 'Nudge',
      errorHeadline: 'Needs a look',
      taskFallback: 'Scheduled task',
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
    clarify: {
      label: '先澄清',
      headline: '还差一点',
      detail: '先补一个关键细节。',
    },
    coPlan: {
      label: '共拟计划',
      headline: '先缩一步',
      detail: '把下一步降到更好开始的尺寸。',
    },
    stabilize: {
      label: '先稳定',
      headline: '先降刺激，再处理任务',
      detail: '先稳住，再往前推。',
    },
    execute: {
      label: '执行',
      headline: '开始推进',
      detail: '现在已经足够具体。',
    },
    nudge: {
      successLabel: '完成',
      successHeadline: '做完了',
      errorLabel: '提醒',
      errorHeadline: '需要看一眼',
      taskFallback: '定时任务',
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
    nudgeKind?: CompanionNudgeKind;
    affect?: CompanionAffectHint;
  }
): CompanionSnapshot => ({
  phase,
  label: params.label,
  headline: params.headline,
  detail: params.detail,
  updatedAt: params.updatedAt,
  ...(params.dormantReason ? { dormantReason: params.dormantReason } : {}),
  ...(params.nudgeKind ? { nudgeKind: params.nudgeKind } : {}),
  ...(params.affect ? { affect: params.affect } : {}),
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
    kind: CompanionNudgeKind;
    taskName: string;
  }
): CompanionSnapshot => {
  if (params.kind === 'reply-complete') {
    const clipped = clipTaskName(params.taskName, '');
    const detail = clipped
      ? `${params.copy.nudge.replyDetail} — ${clipped}`
      : params.copy.nudge.replyDetail;
    return createSnapshot('nudge', {
      label: params.copy.nudge.replyLabel,
      headline: params.copy.nudge.replyLabel,
      detail,
      updatedAt,
      nudgeKind: 'reply-complete',
    });
  }
  return createSnapshot('nudge', {
    label:
      params.kind === 'task-error' ? params.copy.nudge.errorLabel : params.copy.nudge.successLabel,
    headline:
      params.kind === 'task-error'
        ? params.copy.nudge.errorHeadline
        : params.copy.nudge.successHeadline,
    detail: clipTaskName(params.taskName, params.copy.nudge.taskFallback),
    updatedAt,
    nudgeKind: params.kind,
  });
};

const isExpired = (expiresAt: number, nowMs: number): boolean => nowMs >= expiresAt;

const snapshotsEqual = (left: CompanionSnapshot, right: CompanionSnapshot): boolean =>
  left.phase === right.phase &&
  left.label === right.label &&
  left.headline === right.headline &&
  left.detail === right.detail &&
  left.dormantReason === right.dormantReason &&
  left.nudgeKind === right.nudgeKind &&
  left.preview?.kind === right.preview?.kind &&
  left.preview?.text === right.preview?.text &&
  left.preview?.toolName === right.preview?.toolName &&
  left.preview?.threadId === right.preview?.threadId &&
  left.affect?.label === right.affect?.label &&
  left.affect?.valence === right.affect?.valence &&
  left.affect?.arousal === right.affect?.arousal;

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
  let timedPolicyState: TimedPolicyState | null = null;
  let timedNudgeState: TimedNudgeState | null = null;
  let policyTimer: ReturnType<typeof setTimeout> | null = null;
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  let currentSnapshot = createSnapshot('idle', {
    label: COMPANION_COPY.en.idle.label,
    headline: COMPANION_COPY.en.idle.headline,
    detail: COMPANION_COPY.en.idle.detail,
    updatedAt: now().toISOString(),
  });
  let currentPreview: ConversationPreview | null = null;
  let currentAffect: CompanionAffectHint | null = null;

  const clearExpiredState = () => {
    const nowMs = now().getTime();
    if (timedPolicyState && isExpired(timedPolicyState.expiresAt, nowMs)) {
      timedPolicyState = null;
    }
    if (timedNudgeState && isExpired(timedNudgeState.expiresAt, nowMs)) {
      timedNudgeState = null;
    }
  };

  const schedulePolicyExpiry = () => {
    if (policyTimer) {
      clearTimeoutFn(policyTimer);
      policyTimer = null;
    }
    if (!timedPolicyState) return;

    const delay = Math.max(0, timedPolicyState.expiresAt - now().getTime());
    policyTimer = setTimeoutFn(() => {
      timedPolicyState = null;
      policyTimer = null;
      publish();
    }, delay);
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

    if (timedPolicyState) {
      switch (timedPolicyState.policy.interventionState) {
        case 'stabilize':
          return createSnapshot('stabilize', {
            label: copy.stabilize.label,
            headline: copy.stabilize.headline,
            detail: copy.stabilize.detail,
            updatedAt,
          });
        case 'clarify':
          return createSnapshot('clarify', {
            label: copy.clarify.label,
            headline: copy.clarify.headline,
            detail: copy.clarify.detail,
            updatedAt,
          });
        case 'co_plan':
          return createSnapshot('co_plan', {
            label: copy.coPlan.label,
            headline: copy.coPlan.headline,
            detail: copy.coPlan.detail,
            updatedAt,
          });
        case 'guided_execute':
        case 'autonomous_execute':
          return createSnapshot('execute', {
            label: copy.execute.label,
            headline: copy.execute.headline,
            detail: copy.execute.detail,
            updatedAt,
          });
      }
    }

    return createSnapshot('idle', {
      label: copy.idle.label,
      headline: copy.idle.headline,
      detail: copy.idle.detail,
      updatedAt,
      ...(currentAffect ? { affect: currentAffect } : {}),
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
    setAffect: (affect: CompanionAffectHint | null): void => {
      currentAffect = affect;
    },
    setChatPolicy: (policy: InterventionPolicySignal | null): CompanionSnapshot => {
      if (!policy) {
        timedPolicyState = null;
        schedulePolicyExpiry();
        return publish();
      }

      const ttlMs =
        policy.interventionState === 'guided_execute' ||
        policy.interventionState === 'autonomous_execute'
          ? EXECUTE_POLICY_TTL_MS
          : REFLECTIVE_POLICY_TTL_MS;
      timedPolicyState = {
        policy,
        expiresAt: now().getTime() + ttlMs,
      };
      schedulePolicyExpiry();
      return publish();
    },
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
    pushTaskNudge: (params: { kind: CompanionNudgeKind; taskName: string }): CompanionSnapshot => {
      timedNudgeState = {
        kind: params.kind,
        taskName: params.taskName,
        expiresAt: now().getTime() + NUDGE_TTL_MS,
      };
      scheduleNudgeExpiry();
      return publish();
    },
    notifyReplyComplete: (threadLabel?: string): CompanionSnapshot => {
      const label = threadLabel?.trim() || '';
      timedNudgeState = {
        kind: 'reply-complete',
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
