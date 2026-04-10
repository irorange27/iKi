import {
  createConversationHarness,
  type AgentTool,
  type ConversationHarness,
} from '../../../core/agent';
import { getAppConfig } from '../../../core/config';
import * as affectDb from '../../../core/db/affect_state';
import * as chatThreadDb from '../../../core/db/chat_thread';
import { createLogger } from '../../../core/logger';
import {
  type AffectState,
  rehydrateAffectState,
} from '../../../core/emotion/affect_state';
import {
  buildInterventionPolicySystemMessage,
  deriveInterventionPolicy,
} from '../../../core/emotion/intervention_policy';
import { shouldGuardTools } from '../../../core/emotion/affect_policy';
import * as llmFactory from '../../../core/provider/llm/factory';
import * as deepseekProvider from '../../../core/provider/llm/deepseek';
import * as kimiProvider from '../../../core/provider/llm/kimi';
import * as minimaxProvider from '../../../core/provider/llm/minimax';
import * as openaiProvider from '../../../core/provider/llm/openai';
import { defaultToolRegistry } from '../../../core/tools';
import { LoadSkillTool } from '../../../core/tools/skill_tools';
import { buildThreadWorkspaceSystemMessage } from '../../../core/workspaces/thread_workspace';
import { ACP_PROVIDER_TYPE } from '../../../shared/constants/acp';
import type { AffectSignal } from '../../../shared/emotion/affect';
import type {
  ChatAffectExperimentMode,
  ChatExperimentalContext,
  InterventionPolicySignal,
} from '../../../shared/chat/intervention_policy';
import type { AgentRunKind } from '../../../shared/types/agent_run';
import type {
  ProviderModelDescriptor,
  ProviderModelDiscoveryOverride,
} from '../../../shared/types/provider';
import { applyToolApprovalPolicy } from '../../../shared/utils/tool_approval';
import { runWithToolRuntimeContext } from '../../../core/tools/runtime_context';
import { getErrorMessage } from '../../utils/errors';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveChatToolMaxIterations,
} from './chat_constants';
import type { ChatMemory } from './chat_memory';
import { createChatContextAssembler } from './chat_context';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import { createChatConversationRunner } from './chat_conversation_runner';
import { createAgentRunTracker } from './chat_run_tracking';
import { persistThreadRuntimeHints } from './chat_thread_hints';
import { resolveToolNames } from './chat_tools';
import type {
  ActiveStreamState,
  ChatInputMessage,
  ChatTransportMessage,
  ChatWebContents,
} from './chat_types';
import {
  createUiChunkEmitter,
  getPromptFromMessage,
  toLlmChatMessages,
  toModelInputMessages,
} from './chat_ui';
import { createToolLoopRunner, type RegisterApprovalBatch } from './chat_tool_loop';
import { TODO_PLANNING_TOOL_NAME } from './chat_todo_planning';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export const createChatStreaming = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
  memory: ChatMemory;
  usage: {
    recordUsageEvent: (params: {
      threadId?: string;
      messageId?: string;
      providerType: string;
      model: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
        estimatedCostUsd?: number;
      };
      source?: string;
      metadata?: Record<string, unknown>;
    }) => void;
  };
  approvals: {
    ensurePendingApprovalSession: (
      approvalId: string,
      session: {
        harness: ConversationHarness;
        webContents: ChatWebContents;
        history?: import('ai').ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
  };
}) => {
  const toolLoopRunner = createToolLoopRunner({
    registerApprovalBatch: deps.approvals.registerApprovalBatch,
  });
  const contextAssembler = createChatContextAssembler({
    memory: deps.memory,
    workspaceSystemMessage: buildThreadWorkspaceSystemMessage,
  });

  const getEmotionConfig = () => getAppConfig()?.memory?.emotion || null;
  const shouldAutoApproveToolRequests = () =>
    getAppConfig()?.general?.autoApproveToolRequests === true;

  const getStoredAffectState = (threadId?: string): AffectState | null => {
    if (!threadId) return null;
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled) return null;
    const record = affectDb.getAffectState(threadId);
    if (!record?.state) return null;
    return rehydrateAffectState(record.state, { maxAgeMinutes: emotionConfig.maxAgeMinutes });
  };

  const getAffectStateForPolicy = (threadId?: string): AffectState | null => {
    const emotionConfig = getEmotionConfig();
    if (!emotionConfig?.enabled) return null;
    if (threadId) {
      const thread = chatThreadDb.getChatThread(threadId);
      if (thread?.is_incognito) return null;
      const computed = deps.memory.getAffectState?.(threadId) ?? null;
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
    guardActive: boolean
  ): string[] => {
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

  const collectRequiredBuiltinSkillTools = (
    skills: Array<{ requiredTools?: string[] }>
  ): string[] => {
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

  const describeApprovalRequiredTools = (
    requests: Array<{ toolCall?: { toolName: string } }>
  ): string => {
    const toolNames = requests
      .map(request => request.toolCall?.toolName)
      .filter(
        (toolName): toolName is string => typeof toolName === 'string' && toolName.trim().length > 0
      )
      .filter((toolName, index, list) => list.indexOf(toolName) === index);

    if (toolNames.length === 0) {
      return 'Tool approval required for non-interactive chat';
    }

    return `Tool approval required for non-interactive chat: ${toolNames.join(', ')}`;
  };

  const registerToolWithGuard = (
    harness: ConversationHarness,
    toolName: string,
    guardActive: boolean
  ): AgentTool | null => {
    const tool = defaultToolRegistry.get(toolName);
    if (!tool) return null;
    const emotionConfig = getEmotionConfig();
    const requireApproval = guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);
    const registered = applyToolApprovalPolicy(
      requireApproval ? { ...tool, needsApproval: true } : tool,
      {
        autoApproveToolRequests: shouldAutoApproveToolRequests(),
      }
    );
    harness.registerTool(registered);
    return registered;
  };

  const createChatHarness = (params: {
    threadId?: string;
    providerType: string;
    providerId?: string;
    model: string;
    systemPrompt: string;
    enableTools: boolean;
    enabledTools: string[];
    availableSkillIds: string[];
    guardActive: boolean;
    maxIterations: number;
    maxOutputTokens?: number;
  }): ConversationHarness => {
    const runner = createChatConversationRunner({
      providerType: params.providerType,
      providerId: params.providerId,
      model: params.model,
      systemPrompt: params.systemPrompt,
      enableTools: params.enableTools,
      enabledTools: params.enabledTools,
      maxIterations: params.maxIterations,
      ...(typeof params.maxOutputTokens === 'number'
        ? { maxTokens: params.maxOutputTokens }
        : {}),
    });

    const harness = createConversationHarness({
      runner,
      toolRuntimeContext: {
        threadId: params.threadId,
        availableSkillIds: params.availableSkillIds,
        conversationModel: {
          providerType: params.providerType,
          ...(typeof params.providerId === 'string' && params.providerId.trim()
            ? { providerId: params.providerId.trim() }
            : {}),
          model: params.model,
          ...(typeof params.maxOutputTokens === 'number'
            ? { maxTokens: params.maxOutputTokens }
            : {}),
        },
        delegationDepth: 0,
      },
    });

    if (!params.enableTools) {
      return harness;
    }

    if (params.availableSkillIds.length > 0) {
      harness.registerTool(new LoadSkillTool().toAgentTool());
    }

    for (const toolName of params.enabledTools) {
      if (!defaultToolRegistry.get(toolName)) {
        chatStreamingLogger.warn(`Tool ${toolName} not found in registry`);
        continue;
      }
      registerToolWithGuard(harness, toolName, params.guardActive);
    }

    return harness;
  };

  const createApprovalRecoveryContext = (params: {
    threadId?: string;
    sessionId: string;
    runId?: string;
    providerType: string;
    providerId?: string;
    model: string;
    systemPrompt: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxIterations: number;
    enabledTools: string[];
    availableSkillIds: string[];
  }): ApprovalRecoveryContext | undefined => {
    const threadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
    const sessionId = params.sessionId.trim();
    if (!threadId || !sessionId) return undefined;

    return {
      sessionId,
      threadId,
      assistantMessageId: sessionId,
      ...(typeof params.runId === 'string' && params.runId.trim()
        ? { runId: params.runId.trim() }
        : {}),
      providerType: params.providerType,
      ...(typeof params.providerId === 'string' && params.providerId.trim()
        ? { providerId: params.providerId.trim() }
        : {}),
      model: params.model,
      systemPrompt: params.systemPrompt,
      ...(typeof params.maxInputTokens === 'number'
        ? { maxInputTokens: params.maxInputTokens }
        : {}),
      ...(typeof params.maxOutputTokens === 'number'
        ? { maxOutputTokens: params.maxOutputTokens }
        : {}),
      maxIterations: params.maxIterations,
      enabledTools: [...params.enabledTools],
      availableSkillIds: [...params.availableSkillIds],
    };
  };

  const getModels = async (
    providerType: string,
    providerId?: string,
    providerOverride?: ProviderModelDiscoveryOverride | null
  ): Promise<ProviderModelDescriptor[]> => {
    try {
      const toDescriptors = async (modelIds: string[]) => {
        const normalizedIds = modelIds
          .filter((modelId): modelId is string => typeof modelId === 'string')
          .map(modelId => modelId.trim())
          .filter(Boolean)
          .filter((modelId, index, list) => list.indexOf(modelId) === index);

        return await Promise.all(
          normalizedIds.map(async modelId => {
            const capability = await llmFactory.resolveModelCapability(
              providerType,
              modelId,
              providerId
            );

            return {
              id: modelId,
              displayName: capability?.displayName || modelId,
              contextWindow: capability?.contextWindow ?? null,
              maxInputTokens: capability?.maxInputTokens ?? capability?.contextWindow ?? null,
              maxOutputTokens: capability?.maxOutputTokens ?? null,
              ...(capability?.supportsToolCalls !== null &&
              capability?.supportsToolCalls !== undefined
                ? { supportsToolCalls: capability.supportsToolCalls }
                : {}),
              ...(capability?.supportsReasoning !== null &&
              capability?.supportsReasoning !== undefined
                ? { supportsReasoning: capability.supportsReasoning }
                : {}),
              ...(capability?.supportsVision !== null &&
              capability?.supportsVision !== undefined
                ? { supportsVision: capability.supportsVision }
                : {}),
              ...(capability?.source ? { source: capability.source } : {}),
            } satisfies ProviderModelDescriptor;
          })
        );
      };

      if (providerType === ACP_PROVIDER_TYPE) {
        const acpDescriptors = await llmFactory.fetchAcpModels(
          providerType,
          providerId,
          providerOverride ?? undefined
        );
        return await Promise.all(
          acpDescriptors.map(async descriptor => {
            const capability = await llmFactory.resolveModelCapability(
              providerType,
              descriptor.id,
              providerId
            );

            return {
              ...descriptor,
              displayName: capability?.displayName || descriptor.displayName || descriptor.id,
              contextWindow: capability?.contextWindow ?? descriptor.contextWindow ?? null,
              maxInputTokens:
                capability?.maxInputTokens ??
                capability?.contextWindow ??
                descriptor.maxInputTokens ??
                descriptor.contextWindow ??
                null,
              maxOutputTokens: capability?.maxOutputTokens ?? descriptor.maxOutputTokens ?? null,
              supportsToolCalls:
                capability?.supportsToolCalls ?? descriptor.supportsToolCalls ?? true,
              ...(capability?.supportsReasoning !== null &&
              capability?.supportsReasoning !== undefined
                ? { supportsReasoning: capability.supportsReasoning }
                : descriptor.supportsReasoning !== undefined
                  ? { supportsReasoning: descriptor.supportsReasoning }
                  : {}),
              ...(capability?.supportsVision !== null && capability?.supportsVision !== undefined
                ? { supportsVision: capability.supportsVision }
                : descriptor.supportsVision !== undefined
                  ? { supportsVision: descriptor.supportsVision }
                  : {}),
              source: capability?.source || descriptor.source || 'provider',
            } satisfies ProviderModelDescriptor;
          })
        );
      }

      // 1. Try provider-specific cache if it exists (e.g. for DeepSeek special logic)
      if (providerType === 'deepseek') {
        return await toDescriptors(await deepseekProvider.getDeepSeekModels());
      }
      if (providerType === 'openai') {
        return await toDescriptors(await openaiProvider.getOpenAIModels());
      }
      if (providerType === 'kimi') {
        return await toDescriptors(await kimiProvider.getKimiModels());
      }
      if (providerType === 'minimax') {
        return await toDescriptors(await minimaxProvider.getMinimaxModels());
      }

      // 2. Fallback to general factory fetch
      return await toDescriptors(await llmFactory.fetchModelsFromDev(providerType));
    } catch (error: unknown) {
      chatStreamingLogger.error(`Failed to get models for ${providerType}`, error);
      return [];
    }
  };

  const isProviderConfigured = (providerType: string, providerId?: string) => {
    try {
      const config = llmFactory.getProviderConfig(providerType, providerId);
      if (providerType.trim().toLowerCase() === ACP_PROVIDER_TYPE) {
        return config.acpCommand.trim().length > 0;
      }
      return !!config.apiKey;
    } catch {
      return false;
    }
  };

  const stopStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (!streamState) {
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    return { success: true };
  };

  type ChatTurnOptions = {
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
      metadata?: Record<string, unknown>;
    };
  };

  type PreparedChatTurn = {
    report: Awaited<ReturnType<typeof contextAssembler.assemble>>['report'];
    usedSkills: Awaited<ReturnType<typeof contextAssembler.assemble>>['usedSkills'];
    selectedSkillIds: string[];
    skillMode: Awaited<ReturnType<typeof contextAssembler.assemble>>['skillMode'];
    maxInputTokens?: number;
    maxOutputTokens?: number;
    finalMessages: ChatInputMessage[];
    history: ChatInputMessage[];
    prompt: string;
    guardActive: boolean;
    affectSignal: AffectSignal | null;
    interventionPolicy: InterventionPolicySignal | null;
    guardedTools: string[];
    enableTools: boolean;
  };

  const prepareChatTurn = async (
    options: ChatTurnOptions & {
      onMemoryRetrieved?: Parameters<typeof contextAssembler.assemble>[0]['onMemoryRetrieved'];
    }
  ): Promise<PreparedChatTurn> => {
    const modelMessages = await toModelInputMessages(options.messages);
    const modelCapability = await llmFactory.resolveModelCapability(
      options.providerType,
      options.model,
      options.providerId
    );
    const maxInputTokens =
      options.modelCapability?.maxInputTokens ??
      options.modelCapability?.contextWindow ??
      modelCapability?.maxInputTokens ??
      modelCapability?.contextWindow;
    const maxOutputTokens =
      options.modelCapability?.maxOutputTokens ?? modelCapability?.maxOutputTokens;
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
    const storedAffectState = getAffectStateForPolicy(options.threadId);
    const effectiveAffectState = realtimeAffectContext.state ?? storedAffectState;
    const affectSource = realtimeAffectContext.state ? 'realtime' : 'history';
    const experimentalModeActive = experimentalAffectMode !== null;
    const rawAffectEnabled =
      experimentalAffectMode === 'tone_only' || experimentalAffectMode === 'explicit_policy';
    const affectContextMode = experimentalAffectMode === 'no_affect' ? 'disabled' : 'default';
    const guardState = experimentalModeActive ? null : storedAffectState;
    const guardActive = shouldRequireGuardedTools(guardState);
    const affectSignal = experimentalModeActive
      ? rawAffectEnabled
        ? toAffectSignal(effectiveAffectState, affectSource, false)
        : null
      : toAffectSignal(guardState, 'history', guardActive);
    const affectStateForRouting =
      experimentalModeActive || !emotionConfig?.injectToSystemPrompt
        ? null
        : affectSignal?.state ?? null;
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
    const interventionPolicy =
      experimentalAffectMode !== null
        ? {
            ...deriveInterventionPolicy({
              messages: modelMessages,
              affectState:
                experimentalAffectMode === 'explicit_policy' ? effectiveAffectState : null,
            }),
            applied: experimentalAffectMode === 'explicit_policy',
          }
        : null;
    const finalMessages = interventionPolicy?.applied
      ? insertSystemMessages(assembledContext.messages, [
          buildInterventionPolicySystemMessage(interventionPolicy),
        ])
      : assembledContext.messages;
    const selectedSkillIds = assembledContext.usedSkills
      .map(skill => skill.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const { resolvedTools, mode } = await resolveToolNames({
      tools: options.tools,
      mcpServerIds: options.mcpServerIds,
      inputMessages: finalMessages,
      affectState: affectStateForRouting,
    });
    const skillRequiredTools = collectRequiredBuiltinSkillTools(
      Array.isArray(assembledContext.usedSkills) ? assembledContext.usedSkills : []
    );
    const mergedResolvedTools = mergeToolNames(resolvedTools, skillRequiredTools);
    const guardedTools = applyToolGuard(mergedResolvedTools, mode, guardActive).filter(
      toolName => Boolean(options.threadId) || toolName !== TODO_PLANNING_TOOL_NAME
    );

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

    if (!finalMessages || finalMessages.length === 0) {
      throw new Error('No messages provided for chat turn');
    }

    const history = finalMessages.slice(0, -1);
    const lastMessage = finalMessages[finalMessages.length - 1];
    const prompt = getPromptFromMessage(lastMessage);

    return {
      report: assembledContext.report,
      usedSkills: Array.isArray(assembledContext.usedSkills) ? assembledContext.usedSkills : [],
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
      affectSignal,
      interventionPolicy,
      guardedTools,
      enableTools:
        guardedTools.length > 0 ||
        selectedSkillIds.length > 0 ||
        options.providerType.trim().toLowerCase() === ACP_PROVIDER_TYPE,
    };
  };

  const send = async (options: ChatTurnOptions) => {
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;
    try {
      const preparedTurn = await prepareChatTurn(options);
      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);
      const systemPrompt = preparedTurn.enableTools
        ? TOOL_AGENT_SYSTEM_PROMPT
        : NO_TOOLS_SYSTEM_PROMPT;

      runTracker = createAgentRunTracker({
        kind: options.runConfig?.kind ?? 'chat-turn',
        threadId: options.threadId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enabledTools: preparedTurn.guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        input: {
          ...(preparedTurn.prompt.trim() ? { prompt: preparedTurn.prompt } : {}),
          messages: preparedTurn.finalMessages,
          metadata: {
            ...(options.runConfig?.metadata ?? {}),
            transport: 'send',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            skillMode: preparedTurn.skillMode,
            maxIterations,
            enableTools: preparedTurn.enableTools,
          },
        },
        working: {
          modelMessages: preparedTurn.history,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      });

      if (preparedTurn.enableTools) {
        const harness = createChatHarness({
          threadId: options.threadId,
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt,
          enableTools: true,
          enabledTools: preparedTurn.guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          guardActive: preparedTurn.guardActive,
          maxIterations,
          ...(typeof preparedTurn.maxOutputTokens === 'number'
            ? { maxOutputTokens: preparedTurn.maxOutputTokens }
            : {}),
        });

        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const result = await runWithToolRuntimeContext({ runId: runTracker.id }, async () =>
          await harness.generate({
            history: preparedTurn.history,
            prompt: preparedTurn.prompt,
          })
        );
        runTracker.recordToolCalls(result.toolCalls);
        runTracker.syncModelMessages(harness.getHistory?.() ?? preparedTurn.history);
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: result.usage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            approvalRequestCount: result.toolApprovalRequests?.length ?? 0,
          },
        });
        if (result.toolApprovalRequests && result.toolApprovalRequests.length > 0) {
          const approvalError = describeApprovalRequiredTools(result.toolApprovalRequests);
          runTracker.markBlocked({
            text: result.response,
            usage: result.usage ? { ...result.usage } : undefined,
            pendingApprovalIds: result.toolApprovalRequests.map(request => request.approvalId),
          });
          chatStreamingLogger.event({
            level: 'warn',
            event: 'chat.send.approval_required',
            outcome: 'denied',
            message: approvalError,
            data: {
              thread_id: options.threadId || null,
              tool_names: result.toolApprovalRequests
                .map(request => request.toolCall?.toolName)
                .filter(
                  (toolName): toolName is string =>
                    typeof toolName === 'string' && toolName.trim().length > 0
                ),
            },
          });
          throw new Error(approvalError);
        }
        runTracker.markCompleted({
          text: result.response,
          usage: result.usage ? { ...result.usage } : undefined,
          finishReason: 'completed',
        });
        return { success: true, text: result.response };
      }

      // Fallback to simple LLM call
      const result = await llmFactory.generateChatWithUsage({
        providerType: options.providerType,
        providerId: options.providerId,
        modelId: options.model,
        messages: toLlmChatMessages(preparedTurn.finalMessages),
        extraSystemPrompt: NO_TOOLS_SYSTEM_PROMPT,
        ...(typeof preparedTurn.maxOutputTokens === 'number'
          ? { maxOutputTokens: preparedTurn.maxOutputTokens }
          : {}),
      });
      deps.usage.recordUsageEvent({
        threadId: options.threadId,
        providerType: options.providerType,
        model: options.model,
        usage: result.usage,
        source: 'chat.send.llm',
        metadata: {
          contextTokens: preparedTurn.report.totalEstimatedTokens,
        },
      });
      runTracker.markCompleted({
        text: result.text,
        usage: result.usage ? { ...result.usage } : undefined,
        finishReason: 'completed',
      });
      return { success: true, text: result.text };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (runTracker && runTracker.getRun().status === 'running') {
        runTracker.markFailed({ message });
      }
      return { success: false, error: message };
    }
  };

  const stream = async (webContents: ChatWebContents, options: ChatTurnOptions) => {
    const senderId = webContents.id;
    const existingStream = deps.activeStreams.get(senderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('superseded-by-new-request');
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const uiChunkEmitter = createUiChunkEmitter(webContents);
    deps.activeStreams.set(senderId, streamState);
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    try {
      const preparedTurn = await prepareChatTurn({
        ...options,
        onMemoryRetrieved: payload => {
          uiChunkEmitter.emitMemoryRetrieval({
            query: payload.query,
            results: payload.results,
          });
        },
      });
      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);

      if (preparedTurn.usedSkills.length > 0) {
        uiChunkEmitter.emitSkillUsage({
          mode: preparedTurn.skillMode,
          skills: preparedTurn.usedSkills.map(skill => ({
            id: skill.id,
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
            ...(skill.source ? { source: skill.source } : {}),
          })),
        });
      }

      if (preparedTurn.affectSignal) {
        uiChunkEmitter.emitAffectSignal(preparedTurn.affectSignal);
      }

      const systemPrompt = preparedTurn.enableTools
        ? TOOL_AGENT_SYSTEM_PROMPT
        : NO_TOOLS_SYSTEM_PROMPT;
      runTracker = createAgentRunTracker({
        kind: options.runConfig?.kind ?? 'chat-turn',
        threadId: options.threadId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enabledTools: preparedTurn.guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        input: {
          ...(preparedTurn.prompt.trim() ? { prompt: preparedTurn.prompt } : {}),
          messages: preparedTurn.finalMessages,
          metadata: {
            ...(options.runConfig?.metadata ?? {}),
            transport: 'stream',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            skillMode: preparedTurn.skillMode,
            maxIterations,
            enableTools: preparedTurn.enableTools,
            assistantMessageId: uiChunkEmitter.messageId,
          },
        },
        working: {
          modelMessages: preparedTurn.history,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      });
      const approvalContext = preparedTurn.enableTools
        ? createApprovalRecoveryContext({
            threadId: options.threadId,
            sessionId: uiChunkEmitter.messageId,
            runId: runTracker.id,
            providerType: options.providerType,
            providerId: options.providerId,
            model: options.model,
            systemPrompt,
            maxInputTokens: preparedTurn.maxInputTokens,
            maxOutputTokens: preparedTurn.maxOutputTokens,
            maxIterations,
            enabledTools: preparedTurn.guardedTools,
            availableSkillIds: preparedTurn.selectedSkillIds,
          })
        : undefined;

      const harness = createChatHarness({
        threadId: options.threadId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enableTools: preparedTurn.enableTools,
        enabledTools: preparedTurn.guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        guardActive: preparedTurn.guardActive,
        maxIterations,
        ...(typeof preparedTurn.maxOutputTokens === 'number'
          ? { maxOutputTokens: preparedTurn.maxOutputTokens }
          : {}),
      });

      if (!preparedTurn.prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      const streamResult = await runWithToolRuntimeContext({ runId: runTracker.id }, async () =>
        await toolLoopRunner.stream({
          harness,
          webContents,
          history: preparedTurn.history,
          prompt: preparedTurn.prompt,
          approvalContext,
          shouldCancel: () => streamState.cancelled,
          onToolEvent: eventPart => {
            runTracker?.recordToolEvent(eventPart);
            if (
              eventPart.type === 'tool-approval-request' &&
              typeof eventPart.approvalId === 'string' &&
              eventPart.approvalId.length > 0
            ) {
              deps.approvals.ensurePendingApprovalSession(eventPart.approvalId, {
                harness,
                webContents,
                history: preparedTurn.history,
                recoveryContext: approvalContext,
              });
            }
            uiChunkEmitter.emitToolEvent(eventPart);
          },
          abortSignal: streamState.abortController.signal,
          uiChunkEmitter,
          tokenUsageContext: {
            ...(typeof preparedTurn.maxInputTokens === 'number'
              ? { maxInputTokens: preparedTurn.maxInputTokens }
              : {}),
            ...(typeof preparedTurn.maxOutputTokens === 'number'
              ? { maxOutputTokens: preparedTurn.maxOutputTokens }
              : {}),
            model: options.model,
            providerType: options.providerType,
            ...(typeof options.providerId === 'string' && options.providerId.trim()
              ? { providerId: options.providerId.trim() }
              : {}),
          },
        })
      );
      runTracker.syncModelMessages(harness.getHistory?.() ?? preparedTurn.history);
      if (!streamResult.cancelled) {
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          messageId: uiChunkEmitter.messageId,
          providerType: options.providerType,
          model: options.model,
          usage: streamResult.usage,
          source: 'chat.stream',
          metadata: {
            awaitingApproval: streamResult.awaitingApproval,
            contextTokens: preparedTurn.report.totalEstimatedTokens,
          },
        });
      }
      if (streamResult.cancelled) {
        runTracker.markCancelled({
          ...(streamResult.response ? { text: streamResult.response } : {}),
        });
      } else if (streamResult.awaitingApproval) {
        runTracker.markBlocked({
          ...(streamResult.response ? { text: streamResult.response } : {}),
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
        });
      } else {
        runTracker.markCompleted({
          ...(streamResult.response ? { text: streamResult.response } : {}),
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: 'completed',
        });
      }
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        ...(streamResult.response ? { text: streamResult.response } : {}),
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (runTracker && runTracker.getRun().status === 'running') {
          runTracker.markCancelled();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }
      const message = getErrorMessage(error);
      chatStreamingLogger.event({
        level: 'error',
        event: 'chat.stream',
        outcome: 'failed',
        message: 'Stream failed',
        error,
        data: {
          thread_id: options.threadId || null,
          provider_type: options.providerType,
          model: options.model,
          user_facing_error: message,
        },
      });
      if (runTracker && runTracker.getRun().status === 'running') {
        runTracker.markFailed({ message });
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (deps.activeStreams.get(senderId) === streamState) {
        deps.activeStreams.delete(senderId);
      }
    }
  };

  return { getModels, isProviderConfigured, send, stream, stopStream };
};

export type ChatStreaming = ReturnType<typeof createChatStreaming>;
