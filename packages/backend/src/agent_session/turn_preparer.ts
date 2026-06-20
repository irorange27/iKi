import { getAppConfig } from '@iki/backend/config';
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
} from '@iki/backend/chat/intervention_policy';
import type { AgentRunKind } from '@iki/backend/types/agent_run';
import type { SkillSummary } from '@iki/backend/types/skill';
import { ensureModelCapability } from '@iki/backend/utils/provider_models';
import { createChatContextAssembler, type ContextReport } from './context';
import type { ChatMemory } from '../chat_service/memory';
import type { ChatInputMessage, ChatTransportMessage } from '../chat_service/types';
import { persistThreadRuntimeHints } from './thread_hints';
import { resolveToolNames } from './tool_guard';
import { getPromptFromMessage, toModelInputMessages } from '../chat_service/ui_messages';
import { TODO_PLANNING_TOOL_NAME } from '../chat_service/todo_planning';

export type ChatTurnOptions = {
  providerType: string;
  providerId?: string;
  model: string;
  modelCapability?: {
    contextWindow?: number | null;
    maxInputTokens?: number | null;
    maxOutputTokens?: number | null;
  };
  messages: ChatTransportMessage[];
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

const getEmotionConfig = () => getAppConfig()?.memory?.emotion || null;

const getStoredAffectState = (threadId: string | undefined): AffectState | null => {
  if (!threadId) return null;

  const emotionConfig = getEmotionConfig();
  if (!emotionConfig?.enabled) return null;

  const record = affectDb.getAffectState(threadId);
  if (!record?.state) return null;

  return rehydrateAffectState(record.state, { maxAgeMinutes: emotionConfig.maxAgeMinutes });
};

const getAffectStateForPolicy = (
  memory: ChatMemory,
  threadId: string | undefined
): AffectState | null => {
  const emotionConfig = getEmotionConfig();
  if (!emotionConfig?.enabled) return null;

  if (threadId) {
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return null;
    const computed = memory.getAffectState?.(threadId) ?? null;
    if (computed) return computed;
  }

  return getStoredAffectState(threadId);
};

const shouldRequireGuardedTools = (state: AffectState | null | undefined) => {
  const emotionConfig = getEmotionConfig();
  return shouldGuardTools(state, emotionConfig?.toolGuard);
};

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

  const emotionConfig = getEmotionConfig();
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

export const createChatTurnPreparer = (deps: { memory: ChatMemory }) => {
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
    const emotionConfig = getEmotionConfig();
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

    const storedAffectState = getAffectStateForPolicy(deps.memory, options.threadId);
    const effectiveAffectState = realtimeAffectContext.state ?? storedAffectState;
    const affectSource = realtimeAffectContext.state ? 'realtime' : 'history';
    const experimentalModeActive = experimentalAffectMode !== null;
    const rawAffectEnabled =
      experimentalAffectMode === 'tone_only' || experimentalAffectMode === 'explicit_policy';
    const affectContextMode = experimentalAffectMode === 'no_affect' ? 'disabled' : 'default';
    const guardState = experimentalModeActive ? null : storedAffectState;
    const guardActive = shouldRequireGuardedTools(guardState);
    const requireApproval = guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);
    const autoApproveToolRequests =
      getAppConfig()?.general?.autoApproveToolRequests === true;
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
      skillIds: options.skillIds,
      skillMode: options.skillMode,
      contextMode: options.experimentalContext?.contextMode,
      includeMemory: false,
      modelCapability,
      affectState: affectStateForRouting,
      affectContextMode,
      realtimeAffectMessage,
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
    });
    const skillRequiredTools = collectRequiredBuiltinSkillTools(usedSkills);
    const mergedResolvedTools = mergeToolNames(resolvedTools, skillRequiredTools);
    const guardedTools = applyToolGuard(mergedResolvedTools, mode, guardActive, interventionPolicy).filter(
      toolName => Boolean(options.threadId) || toolName !== TODO_PLANNING_TOOL_NAME
    );

    // Shell is always available; execution still requires per-command user approval.
    if (!guardedTools.includes('shell')) {
      guardedTools.push('shell');
    }

    persistThreadRuntimeHints({
      threadId: options.threadId ?? '',
      providerType: options.providerType,
      providerId: options.providerId,
      model: options.model,
      tools: guardedTools,
      toolMode: mode,
      mcpServerIds: options.mcpServerIds,
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
