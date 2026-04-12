import * as providerDb from '../../../core/db/providers';
import { getAppConfig } from '../../../core/config';
import { createLogger } from '../../../core/logger';
import { parseModelList } from '../../../shared/utils/provider_models';
import type {
  CompanionDormantReason,
  CompanionNudgeKind,
  CompanionPhase,
  CompanionSnapshot,
} from '../../../shared/types/companion';
import type { AppConfig } from '../../../shared/types/config';
import type { Provider } from '../../../shared/types/provider';
import type { InterventionPolicySignal } from '../../../shared/chat/intervention_policy';
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
      providerHeadline: 'Provider needed',
      providerDetail: 'Connect one enabled provider to wake the companion layer.',
      modelHeadline: 'Model needed',
      modelDetail: 'At least one enabled provider still needs a usable model.',
    },
    idle: {
      label: 'Ready',
      headline: 'Standing by',
      detail: 'Watching for the next turn, reminder, or task handoff.',
    },
    thinking: {
      label: 'Thinking',
      headline: 'Synthesizing',
      detail: 'Pulling context together before the next visible move.',
    },
    clarify: {
      label: 'Clarify',
      headline: 'One question first',
      detail: 'The request still needs a missing decision or missing piece of context.',
    },
    coPlan: {
      label: 'Co-plan',
      headline: 'Shrink the next step',
      detail: 'The task is real, but the path should be gentler and more collaborative.',
    },
    stabilize: {
      label: 'Stabilize',
      headline: 'Lower the pressure',
      detail: 'Hold the edge, reduce stimulation, and avoid hard task pushing.',
    },
    execute: {
      label: 'Execute',
      headline: 'Ready to advance',
      detail: 'The task is concrete enough to move forward without another framing loop.',
    },
    nudge: {
      successLabel: 'Done',
      successHeadline: 'Task completed',
      errorLabel: 'Nudge',
      errorHeadline: 'Task needs attention',
      taskFallback: 'Scheduled task',
    },
  },
  'zh-CN': {
    dormant: {
      label: '休眠',
      providerHeadline: '需要 Provider',
      providerDetail: '先接入一个已启用的 Provider，外显层才会真正醒来。',
      modelHeadline: '需要模型',
      modelDetail: '至少有一个已启用 Provider 还需要可用模型。',
    },
    idle: {
      label: '待命',
      headline: '保持在场',
      detail: '等待下一轮对话、提醒或任务接力。',
    },
    thinking: {
      label: '思考中',
      headline: '正在汇聚上下文',
      detail: '先把记忆、任务和当前输入整合起来，再决定下一步。',
    },
    clarify: {
      label: '先澄清',
      headline: '先问一个关键问题',
      detail: '当前请求还缺一个决定点，或还缺一块必要上下文。',
    },
    coPlan: {
      label: '共拟计划',
      headline: '先把下一步缩小',
      detail: '任务方向是清楚的，但推进方式需要更低压力、更共同行动。',
    },
    stabilize: {
      label: '先稳定',
      headline: '先降刺激，再处理任务',
      detail: '当前更适合稳住状态，避免继续高压推进。',
    },
    execute: {
      label: '执行',
      headline: '可以继续推进',
      detail: '任务已经足够具体，可以进入实际推进而不是继续绕圈。',
    },
    nudge: {
      successLabel: '完成',
      successHeadline: '任务已完成',
      errorLabel: '提醒',
      errorHeadline: '任务需要关注',
      taskFallback: '定时任务',
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
  }
): CompanionSnapshot => ({
  phase,
  label: params.label,
  headline: params.headline,
  detail: params.detail,
  updatedAt: params.updatedAt,
  ...(params.dormantReason ? { dormantReason: params.dormantReason } : {}),
  ...(params.nudgeKind ? { nudgeKind: params.nudgeKind } : {}),
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
): CompanionSnapshot =>
  createSnapshot('nudge', {
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

const isExpired = (expiresAt: number, nowMs: number): boolean => nowMs >= expiresAt;

const snapshotsEqual = (left: CompanionSnapshot, right: CompanionSnapshot): boolean =>
  left.phase === right.phase &&
  left.label === right.label &&
  left.headline === right.headline &&
  left.detail === right.detail &&
  left.dormantReason === right.dormantReason &&
  left.nudgeKind === right.nudgeKind;

export const createCompanionService = (deps: CompanionServiceDeps = {}) => {
  const getConfig = deps.getConfig ?? getAppConfig;
  const listProviders = deps.listProviders ?? providerDb.getProviders;
  const listWindows = deps.listWindows ?? getAllBrowserWindows;
  const now = deps.now ?? (() => new Date());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;

  const thinkingKeys = new Set<string>();
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
      thinkingKeys.add(trimmedKey);
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
  };
};

export type CompanionService = ReturnType<typeof createCompanionService>;

export const companionService = createCompanionService();
