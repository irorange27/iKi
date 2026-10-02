import * as affectDb from '@iki/backend/db/affect_state';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { type AffectState, rehydrateAffectState } from '@iki/backend/affect/affect_state';
import {
  buildInterventionPolicySystemMessage,
  deriveInterventionPolicy,
  filterToolsByInterventionState,
} from '@iki/backend/affect/intervention_policy';
import { shouldGuardTools } from '@iki/backend/affect/affect_policy';
import * as llmFactory from '../provider/llm/factory';
import { defaultToolRegistry } from '@iki/backend/tools';
import { buildThreadWorkspaceSystemMessage } from '@iki/backend/workspaces/thread_workspace';
import { ACP_PROVIDER_TYPE } from '@iki/backend/constants/acp';
import type { AffectSignal } from '@iki/backend/types/affect';
import type {
  ChatAffectExperimentMode,
  ChatExperimentalContext,
  InterventionPolicySignal,
} from '@iki/backend/message/intervention_policy';
import type { AgentRunKind } from '@iki/backend/types/agent_run';
import type { AppConfig } from '@iki/backend/types/config';
import type { SkillSummary } from '@iki/backend/types/skill';
import { ensureModelCapability } from '@iki/backend/utils/provider_models';
import { createChatContextAssembler, type ContextReport } from './context';
import type { ChatMemory } from '../thread_session/memory';
import type { ChatInputMessage, ChatTransportMessage } from '@iki/backend/message/chat_message_types';
import { persistThreadRuntimeHints } from './thread_hints';
import { resolveToolNames } from './tool_guard';
import { getPromptFromMessage, toModelInputMessages } from '@iki/backend/message/ui_messages';
import { TODO_PLANNING_TOOL_NAME } from '@iki/backend/tools/task_plan_tools';

/**
 * Rehydration paths pass an explicit requireApproval to reproduce the approval
 * contract the original turn ran under; ordinary turns leave it unset so the
 * affect-guard derivation stays authoritative.
 */
export const resolveRequireApproval = (
  explicit: boolean | undefined,
  guardActive: boolean,
  emotionConfig?: { toolGuard?: { requireApproval?: boolean } } | null
): boolean =>
  typeof explicit === 'boolean'
    ? explicit
    : guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);

export type ChatTurnOptions = {
  providerType: string;
  providerId?: string;
  model: string;
  /** Per-thread reasoning effort override ('low' | 'medium' | 'high'); empty/omitted = provider default. */
  reasoningEffort?: string;
  /** Per-thread agent personality ('default' | 'concise' | 'friendly'). */
  personality?: string;
  /** Session-level tool approval policy; validated downstream. */
  approvalPolicy?: string;
  /**
   * Explicit override of the guard-derived requireApproval. Rehydration paths
   * set it to reproduce the approval contract the original turn ran under;
   * ordinary turns leave it unset so the affect guard stays authoritative.
   */
  requireApproval?: boolean;
  modelCapability?: {
    contextWindow?: number | null;
    maxInputTokens?: number | null;
    maxOutputTokens?: number | null;
  };
  messages: ChatTransportMessage[];
  /**
   * The turn-start workspace world (D30), resolved by the entry at admission.
   * Context projection renders this world — matching the tools, which run
   * under the same snapshot — instead of re-resolving the thread's current
   * selection after preparation awaits. Undefined = resolve fresh (legacy).
   */
  workspaceSelection?: import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null;
  tools?: string[];
  mcpServerIds?: string[];
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  threadId?: string;
  maxIterations?: number;
  experimentalContext?: ChatExperimentalContext;
  runConfig?: {
    kind?: AgentRunKind;
    parentRunId?: string;
    rootRunId?: string;
    metadata?: Record<string, unknown>;
    /** Execute the turn inside this already-queued run id (queued resume /
     * retry adoption) instead of creating a new run identity. */
    adoptRunId?: string;
  };
  autonomous?: {
    maxIterations: number;
    continuePrompt?: string;
  };
};

export type PreparedChatTurn = {
  report: ContextReport;
  usedSkills: SkillSummary[];
  selectedSkillIds: string[];
  skillMode: 'manual' | 'auto';
  maxInputTokens?: number;
  maxOutputTokens?: number;
  finalMessages: ChatInputMessage[];
  history: ChatInputMessage[];
  prompt: string;
  guardActive: boolean;
  requireApproval: boolean;
  autoApproveToolRequests: boolean;
  affectSignal: AffectSignal | null;
  interventionPolicy: InterventionPolicySignal | null;
  guardedTools: string[];
  enableTools: boolean;
};

/**
 * App-config slices this module consumes, resolved by the composition root
 * (thread_session) per turn — turn_prep never reads global config itself.
 */
export type ChatTurnRuntimeConfig = {
  emotion: AppConfig['memory']['emotion'] | null;
  autoApproveToolRequests: boolean;
  memoryContext: AppConfig['memory']['context'] | null;
};

const getStoredAffectState = (
  emotionConfig: ChatTurnRuntimeConfig['emotion'],
  threadId: string | undefined
): AffectState | null => {
  if (!threadId) return null;

  if (!emotionConfig?.enabled) return null;

  const record = affectDb.getAffectState(threadId);
  if (!record?.state) return null;

  return rehydrateAffectState(record.state, { maxAgeMinutes: emotionConfig.maxAgeMinutes });
};

const getAffectStateForPolicy = (
  memory: ChatMemory,
  emotionConfig: ChatTurnRuntimeConfig['emotion'],
  threadId: string | undefined
): AffectState | null => {
  if (!emotionConfig?.enabled) return null;

  if (threadId) {
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return null;
    const computed = memory.getAffectState?.(threadId) ?? null;
    if (computed) return computed;
  }

  return getStoredAffectState(emotionConfig, threadId);
};

const shouldRequireGuardedTools = (
  state: AffectState | null | undefined,
  emotionConfig: ChatTurnRuntimeConfig['emotion']
) => shouldGuardTools(state, emotionConfig?.toolGuard);

const toAffectSignal = (
  state: AffectState | null,
  source: 'history' | 'realtime',
  guardActive: boolean
): AffectSignal | null => {
  if (!state) return null;

  return {
    source,
    guardActive,
    state,
  };
};

const applyToolGuard = (
  tools: string[],
  mode: 'manual' | 'auto',
  guardActive: boolean,
  emotionConfig: ChatTurnRuntimeConfig['emotion'],
  interventionPolicy?: InterventionPolicySignal
): string[] => {
  // Intervention-state-based hard blocking: remove tools whose risk category
  // is blocked under the current intervention state (stabilize / clarify / co_plan).
  if (interventionPolicy) {
    tools = filterToolsByInterventionState(
      tools,
      interventionPolicy.interventionState,
      interventionPolicy.applied === true
    );
  }

  if (!guardActive || !emotionConfig?.toolGuard) return tools;
  if (mode === 'auto' && emotionConfig.toolGuard.disableAutoTools) {
    return [];
  }
  return tools;
};

const mergeToolNames = (primary: string[], secondary: string[]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const toolName of [...primary, ...secondary]) {
    if (typeof toolName !== 'string') continue;
    const trimmed = toolName.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }

  return merged;
};

const insertSystemMessages = (
  messages: ChatInputMessage[],
  additions: string[]
): ChatInputMessage[] => {
  const nextSystemMessages = additions
    .map(content => content.trim())
    .filter(Boolean)
    .map(content => ({ role: 'system', content }) as ChatInputMessage);

  if (nextSystemMessages.length === 0) return messages;

  const insertIndex = messages.findIndex(message => message.role !== 'system');
  const headIndex = insertIndex === -1 ? messages.length : insertIndex;
  return [...messages.slice(0, headIndex), ...nextSystemMessages, ...messages.slice(headIndex)];
};

const getExperimentalAffectMode = (
  experimentalContext?: ChatExperimentalContext
): ChatAffectExperimentMode | null => {
  const affectMode = experimentalContext?.affectMode;
  return affectMode === 'no_affect' ||
    affectMode === 'tone_only' ||
    affectMode === 'explicit_policy'
    ? affectMode
    : null;
};

const collectRequiredBuiltinSkillTools = (skills: SkillSummary[]): string[] => {
  const requiredTools: string[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    for (const toolName of skill.requiredTools ?? []) {
      if (typeof toolName !== 'string') continue;
      const trimmed = toolName.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      const tool = defaultToolRegistry.get(trimmed);
      if (!tool || tool.source?.kind === 'mcp') continue;
      seen.add(trimmed);
      requiredTools.push(trimmed);
    }
  }

  return requiredTools;
};

export const createChatTurnPreparer = (deps: {
  memory: ChatMemory;
  getRuntimeConfig: () => ChatTurnRuntimeConfig;
}) => {
  const contextAssembler = createChatContextAssembler({
    memory: deps.memory,
    workspaceSystemMessage: buildThreadWorkspaceSystemMessage,
  });

  const prepareChatTurn = async (
    options: ChatTurnOptions & {
      onMemoryRetrieved?: Parameters<typeof contextAssembler.assemble>[0]['onMemoryRetrieved'];
    }
  ): Promise<PreparedChatTurn> => {
    const modelMessages = await toModelInputMessages(options.messages);
    const resolvedModelCapability = await llmFactory.resolveModelCapability(
      options.providerType,
      options.model,
      options.providerId
    );
    const modelCapability = ensureModelCapability(
      options.providerType,
      options.model,
      resolvedModelCapability,
      options.modelCapability
    );
    const maxInputTokens = modelCapability.maxInputTokens;
    const maxOutputTokens = modelCapability.maxOutputTokens ?? undefined;
    const lastModelMessage = modelMessages[modelMessages.length - 1];
    const runtimeConfig = deps.getRuntimeConfig();
    const emotionConfig = runtimeConfig.emotion;
    const experimentalAffectMode = getExperimentalAffectMode(options.experimentalContext);
    const shouldAwaitRealtimeAffect = options.experimentalContext?.awaitRealtimeAffect === true;
    const lastPrompt = lastModelMessage ? getPromptFromMessage(lastModelMessage) : '';
    const realtimeAffectContext =
      lastPrompt && shouldAwaitRealtimeAffect && deps.memory.buildRealtimeAffectContext
        ? await deps.memory.buildRealtimeAffectContext(options.threadId, lastPrompt, {
            force: true,
          })
        : { message: '', state: null };

    if (lastPrompt && !shouldAwaitRealtimeAffect) {
      deps.memory.preloadRealtimeEmotion?.(options.threadId, lastPrompt);
    }

    const storedAffectState = getAffectStateForPolicy(deps.memory, emotionConfig, options.threadId);
    const effectiveAffectState = realtimeAffectContext.state ?? storedAffectState;
    const affectSource = realtimeAffectContext.state ? 'realtime' : 'history';
    const experimentalModeActive = experimentalAffectMode !== null;
    const rawAffectEnabled =
      experimentalAffectMode === 'tone_only' || experimentalAffectMode === 'explicit_policy';
    const affectContextMode = experimentalAffectMode === 'no_affect' ? 'disabled' : 'default';
    const guardState = experimentalModeActive ? null : storedAffectState;
    const guardActive = shouldRequireGuardedTools(guardState, emotionConfig);
    const requireApproval = resolveRequireApproval(
      options.requireApproval,
      guardActive,
      emotionConfig
    );
    const autoApproveToolRequests = runtimeConfig.autoApproveToolRequests;
    const affectSignal = experimentalModeActive
      ? rawAffectEnabled
        ? toAffectSignal(effectiveAffectState, affectSource, false)
        : null
      : toAffectSignal(guardState, 'history', guardActive);
    const affectStateForRouting =
      experimentalModeActive || !emotionConfig?.injectToSystemPrompt
        ? null
        : (affectSignal?.state ?? null);
    const realtimeAffectMessage =
      rawAffectEnabled || shouldAwaitRealtimeAffect ? realtimeAffectContext.message : '';

    const assembledContext = await contextAssembler.assemble({
      messages: modelMessages,
      threadId: options.threadId,
      workspaceSelection: options.workspaceSelection,
      skillIds: options.skillIds,
      skillMode: options.skillMode,
      contextMode: options.experimentalContext?.contextMode,
      includeMemory: false,
      modelCapability,
      affectState: affectStateForRouting,
      affectContextMode,
      realtimeAffectMessage,
      memoryContextConfig: runtimeConfig.memoryContext,
      onMemoryRetrieved: options.onMemoryRetrieved,
    });
    const interventionPolicy = {
      ...deriveInterventionPolicy({
        messages: modelMessages,
        affectState:
          experimentalAffectMode === 'no_affect' || experimentalAffectMode === 'tone_only'
            ? null
            : effectiveAffectState,
      }),
      applied: experimentalAffectMode === 'explicit_policy',
    };
    const finalMessages = interventionPolicy?.applied
      ? insertSystemMessages(assembledContext.messages, [
          buildInterventionPolicySystemMessage(interventionPolicy),
        ])
      : assembledContext.messages;
    const usedSkills = Array.isArray(assembledContext.usedSkills)
      ? assembledContext.usedSkills
      : [];
    const selectedSkillIds = usedSkills
      .map(skill => skill.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const { resolvedTools, mode } = await resolveToolNames({
      tools: options.tools,
      mcpServerIds: options.mcpServerIds,
      inputMessages: finalMessages,
      affectState: affectStateForRouting,
      autoApproveToolRequests,
    });
    // An explicit tools array is the caller's capability upper bound (the
    // resolveToolNames contract: an explicit empty array disables tools).
    // Never expand it — daemon grants, NapCat and proactive-task safe lists
    // all arrive here pre-filtered. Only auto mode (no tools param) keeps the
    // desktop default of an always-exposed shell; execution still requires
    // per-command user approval.
    const explicitToolSelection = Array.isArray(options.tools);
    const skillRequiredTools = explicitToolSelection
      ? []
      : collectRequiredBuiltinSkillTools(usedSkills);
    const mergedResolvedTools = mergeToolNames(resolvedTools, skillRequiredTools);
    const guardedTools = applyToolGuard(
      mergedResolvedTools,
      mode,
      guardActive,
      emotionConfig,
      interventionPolicy
    ).filter(toolName => Boolean(options.threadId) || toolName !== TODO_PLANNING_TOOL_NAME);

    if (!explicitToolSelection && !guardedTools.includes('shell')) {
      guardedTools.push('shell');
    }

    persistThreadRuntimeHints({
      threadId: options.threadId ?? '',
      providerType: options.providerType,
      providerId: options.providerId,
      model: options.model,
      affectSignal,
      interventionPolicy,
    });

    if (finalMessages.length === 0) {
      throw new Error('No messages provided for chat turn');
    }

    const history = finalMessages.slice(0, -1);
    const lastMessage = finalMessages[finalMessages.length - 1];
    const prompt = getPromptFromMessage(lastMessage);

    return {
      report: assembledContext.report,
      usedSkills,
      selectedSkillIds,
      skillMode: assembledContext.skillMode,
      ...(typeof maxInputTokens === 'number' ? { maxInputTokens } : {}),
      ...(typeof maxOutputTokens === 'number'
        ? { maxOutputTokens }
        : typeof assembledContext.effectiveContextConfig?.maxOutputTokens === 'number'
          ? { maxOutputTokens: assembledContext.effectiveContextConfig.maxOutputTokens }
          : {}),
      finalMessages,
      history,
      prompt,
      guardActive,
      requireApproval,
      autoApproveToolRequests,
      affectSignal,
      interventionPolicy,
      guardedTools,
      enableTools:
        guardedTools.length > 0 ||
        selectedSkillIds.length > 0 ||
        options.providerType.trim().toLowerCase() === ACP_PROVIDER_TYPE,
    };
  };

  return { prepareChatTurn };
};

export type ChatTurnPreparer = ReturnType<typeof createChatTurnPreparer>;
