import { type ConversationRunner } from '../../../core/agent';
import { getAppConfig } from '../../../core/config';
import * as affectDb from '../../../core/db/affect_state';
import * as chatThreadDb from '../../../core/db/chat_thread';
import * as emotionDb from '../../../core/db/emotion';
import * as memoryDb from '../../../core/db/memory';
import {
  type AffectState,
  buildAffectSystemMessage,
  collectEmotionSamples,
  computeAffectState,
  rehydrateAffectState,
} from '../../../core/emotion/affect_state';
import { shouldGuardTools } from '../../../core/emotion/affect_policy';
import { analyzeEmotionWithAgent } from '../../../core/provider/emotion_model';
import * as llmFactory from '../../../core/provider/llm/factory';
import * as deepseekProvider from '../../../core/provider/llm/deepseek';
import * as kimiProvider from '../../../core/provider/llm/kimi';
import * as openaiProvider from '../../../core/provider/llm/openai';
import { defaultToolRegistry } from '../../../core/tools';
import { runWithToolRuntimeContext } from '../../../core/tools/runtime_context';
import { buildThreadWorkspaceSystemMessage } from '../../../core/workspaces/thread_workspace';
import { getErrorMessage } from '../../utils/errors';
import { TOOL_AGENT_SYSTEM_PROMPT } from './chat_constants';
import type { ChatMemory } from './chat_memory';
import { createChatContextAssembler } from './chat_context';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import { createChatConversationRunner } from './chat_conversation_runner';
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
        runner: ConversationRunner;
        webContents: ChatWebContents;
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

  const getMemoryConfig = () => getAppConfig()?.memory || null;
  const getEmotionConfig = () => getAppConfig()?.memory?.emotion || null;

  const canStoreShortMemory = () => {
    const memoryConfig = getMemoryConfig();
    return Boolean(memoryConfig?.enabled || memoryConfig?.autoSummarize);
  };

  const buildRealtimeAffectContext = async (
    threadId: string | undefined,
    prompt: string
  ): Promise<{ message: string; state: AffectState | null }> => {
    const emotionConfig = getEmotionConfig();
    if (
      !emotionConfig?.enabled ||
      !emotionConfig.injectToSystemPrompt ||
      !emotionConfig.realtimeAnalysis
    ) {
      return { message: '', state: null };
    }

    const content = prompt.trim();
    if (!content) return { message: '', state: null };

    const minSampleCount = Math.max(1, Math.floor(emotionConfig.minSampleCount || 1));
    if (!threadId && minSampleCount > 1) return { message: '', state: null };

    if (threadId) {
      const thread = chatThreadDb.getChatThread(threadId);
      if (thread?.is_incognito) return { message: '', state: null };
    }

    let emotion;
    try {
      emotion = await analyzeEmotionWithAgent(content);
    } catch (error) {
      console.warn('[Emotion][Main] realtime analysis failed:', error);
      return { message: '', state: null };
    }
    if (!emotion) return { message: '', state: null };

    if (threadId) {
      deps.memory.recordRealtimeEmotion?.(threadId, content, emotion);
    }

    const realtimeSample = {
      emotion: {
        label: emotion.label,
        confidence: emotion.confidence,
        ...(typeof emotion.valence === 'number' ? { valence: emotion.valence } : {}),
        ...(typeof emotion.arousal === 'number' ? { arousal: emotion.arousal } : {}),
        ...(emotion.emotions ? { emotions: emotion.emotions } : {}),
      },
      timestamp: new Date(),
    };

    const fetchLimit = Math.max(10, Math.floor(emotionConfig.windowSize || 0) * 3, minSampleCount);

    const samples = [realtimeSample];
    if (threadId) {
      const events = emotionDb.listEmotionEvents(threadId, fetchLimit);
      samples.push(...collectEmotionSamples(events));
    }

    let affectState = computeAffectState(samples, emotionConfig);
    if (!affectState && threadId && canStoreShortMemory()) {
      const shortEntries = memoryDb.listShortMemory(threadId, fetchLimit);
      affectState = computeAffectState(
        [realtimeSample, ...collectEmotionSamples(shortEntries)],
        emotionConfig
      );
    }

    if (!affectState) return { message: '', state: null };
    return { message: buildAffectSystemMessage(affectState), state: affectState };
  };

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

  const registerToolWithGuard = (
    runner: ConversationRunner,
    toolName: string,
    guardActive: boolean
  ) => {
    const tool = defaultToolRegistry.get(toolName);
    if (!tool) return;
    const emotionConfig = getEmotionConfig();
    const requireApproval = guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);
    const registered = requireApproval ? { ...tool, needsApproval: true } : tool;
    runner.registerTool(registered);
  };

  const createApprovalRecoveryContext = (params: {
    threadId?: string;
    sessionId: string;
    providerType: string;
    model: string;
    systemPrompt: string;
    enabledTools: string[];
  }): ApprovalRecoveryContext | undefined => {
    const threadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
    const sessionId = params.sessionId.trim();
    if (!threadId || !sessionId) return undefined;

    return {
      sessionId,
      threadId,
      assistantMessageId: sessionId,
      providerType: params.providerType,
      model: params.model,
      systemPrompt: params.systemPrompt,
      enabledTools: [...params.enabledTools],
    };
  };

  const getModels = async (providerType: string) => {
    try {
      // 1. Try provider-specific cache if it exists (e.g. for DeepSeek special logic)
      if (providerType === 'deepseek') return await deepseekProvider.getDeepSeekModels();
      if (providerType === 'openai') return await openaiProvider.getOpenAIModels();
      if (providerType === 'kimi') return await kimiProvider.getKimiModels();

      // 2. Fallback to general factory fetch
      return await llmFactory.fetchModelsFromDev(providerType);
    } catch (error: unknown) {
      console.error(`Failed to get models for ${providerType}:`, error);
      return [];
    }
  };

  const isProviderConfigured = (providerType: string) => {
    try {
      const config = llmFactory.getProviderConfig(providerType);
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
    model: string;
    messages: ChatTransportMessage[];
    tools?: string[];
    mcpServerIds?: string[];
    skillIds?: string[];
    skillMode?: 'manual' | 'auto';
    threadId?: string;
  };

  type PreparedChatTurn = {
    report: Awaited<ReturnType<typeof contextAssembler.assemble>>['report'];
    usedSkills: Awaited<ReturnType<typeof contextAssembler.assemble>>['usedSkills'];
    skillMode: Awaited<ReturnType<typeof contextAssembler.assemble>>['skillMode'];
    finalMessages: ChatInputMessage[];
    history: ChatInputMessage[];
    prompt: string;
    guardActive: boolean;
    guardedTools: string[];
    enableTools: boolean;
  };

  const prepareChatTurn = async (
    options: ChatTurnOptions & {
      onMemoryRetrieved?: Parameters<typeof contextAssembler.assemble>[0]['onMemoryRetrieved'];
    }
  ): Promise<PreparedChatTurn> => {
    const modelMessages = await toModelInputMessages(options.messages);
    const lastModelMessage = modelMessages[modelMessages.length - 1];
    const realtimeContext = lastModelMessage
      ? await buildRealtimeAffectContext(options.threadId, getPromptFromMessage(lastModelMessage))
      : { message: '', state: null };
    const assembledContext = await contextAssembler.assemble({
      messages: modelMessages,
      threadId: options.threadId,
      skillIds: options.skillIds,
      skillMode: options.skillMode,
      realtimeAffectMessage: realtimeContext.message,
      onMemoryRetrieved: options.onMemoryRetrieved,
    });
    const finalMessages = assembledContext.messages;

    const affectStateForPolicy = realtimeContext.state ?? getAffectStateForPolicy(options.threadId);
    const guardActive = shouldRequireGuardedTools(affectStateForPolicy);

    const { resolvedTools, mode } = await resolveToolNames({
      tools: options.tools,
      mcpServerIds: options.mcpServerIds,
      inputMessages: finalMessages,
    });
    const guardedTools = applyToolGuard(resolvedTools, mode, guardActive);

    persistThreadRuntimeHints({
      threadId: options.threadId ?? '',
      providerType: options.providerType,
      model: options.model,
      tools: guardedTools,
      toolMode: mode,
      mcpServerIds: options.mcpServerIds,
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
      skillMode: assembledContext.skillMode,
      finalMessages,
      history,
      prompt,
      guardActive,
      guardedTools,
      enableTools: guardedTools.length > 0,
    };
  };

  const send = async (options: ChatTurnOptions) => {
    try {
      const preparedTurn = await prepareChatTurn(options);

      if (preparedTurn.enableTools) {
        const runner = createChatConversationRunner({
          providerType: options.providerType,
          model: options.model,
          systemPrompt: TOOL_AGENT_SYSTEM_PROMPT,
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of preparedTurn.guardedTools) {
          registerToolWithGuard(runner, toolName, preparedTurn.guardActive);
        }

        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const result = await runWithToolRuntimeContext(
          { threadId: options.threadId },
          async () =>
            await runner.generate({
              history: preparedTurn.history,
              prompt: preparedTurn.prompt,
            })
        );
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: result.usage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
          },
        });
        return { success: true, text: result.response };
      }

      // Fallback to simple LLM call
      const result = await llmFactory.generateChatWithUsage({
        providerType: options.providerType,
        modelId: options.model,
        messages: toLlmChatMessages(preparedTurn.finalMessages),
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
      return { success: true, text: result.text };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
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

      if (preparedTurn.usedSkills.length > 0) {
        webContents.send('chat:ui-chunk', {
          type: 'skill-usage',
          mode: preparedTurn.skillMode,
          skills: preparedTurn.usedSkills.map(skill => ({
            id: skill.id,
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
            ...(skill.source ? { source: skill.source } : {}),
          })),
        });
      }

      uiChunkEmitter.emitContextReport(preparedTurn.report);

      const systemPrompt = preparedTurn.enableTools ? TOOL_AGENT_SYSTEM_PROMPT : '';
      const approvalContext = preparedTurn.enableTools
        ? createApprovalRecoveryContext({
            threadId: options.threadId,
            sessionId: uiChunkEmitter.messageId,
            providerType: options.providerType,
            model: options.model,
            systemPrompt,
            enabledTools: preparedTurn.guardedTools,
          })
        : undefined;

      const runner = createChatConversationRunner({
        providerType: options.providerType,
        model: options.model,
        systemPrompt,
        enableTools: preparedTurn.enableTools,
        maxIterations: 5,
      });

      if (preparedTurn.enableTools) {
        for (const toolName of preparedTurn.guardedTools) {
          if (!defaultToolRegistry.get(toolName)) {
            console.warn(`[Main] Tool ${toolName} not found in registry`);
            continue;
          }
          registerToolWithGuard(runner, toolName, preparedTurn.guardActive);
        }
      }

      if (!preparedTurn.prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      const streamResult = await runWithToolRuntimeContext(
        { threadId: options.threadId },
        async () =>
          await toolLoopRunner.stream({
            runner,
            webContents,
            history: preparedTurn.history,
            prompt: preparedTurn.prompt,
            approvalContext,
            shouldCancel: () => streamState.cancelled,
            onToolEvent: eventPart => {
              if (
                eventPart.type === 'tool-approval-request' &&
                typeof eventPart.approvalId === 'string' &&
                eventPart.approvalId.length > 0
              ) {
                deps.approvals.ensurePendingApprovalSession(eventPart.approvalId, {
                  runner,
                  webContents,
                  recoveryContext: approvalContext,
                });
              }
              uiChunkEmitter.emitToolEvent(eventPart);
            },
            abortSignal: streamState.abortController.signal,
            uiChunkEmitter,
          })
      );
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
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        return { success: true, stopped: streamState.stoppedByUser };
      }
      const message = getErrorMessage(error);
      console.error('[Main] Stream failed:', message);
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
