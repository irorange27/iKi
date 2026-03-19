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
import { getErrorMessage } from '../../utils/errors';
import { TOOL_AGENT_SYSTEM_PROMPT } from './chat_constants';
import type { ChatMemory } from './chat_memory';
import { resolveSkillsSystemPrompt } from './chat_skills';
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
  approvals: {
    ensurePendingApprovalSession: (
      approvalId: string,
      session: { runner: ConversationRunner; webContents: ChatWebContents }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
  };
}) => {
  const toolLoopRunner = createToolLoopRunner({
    registerApprovalBatch: deps.approvals.registerApprovalBatch,
  });

  const getMemoryConfig = () => getAppConfig()?.memory || null;
  const getEmotionConfig = () => getAppConfig()?.memory?.emotion || null;

  const canStoreShortMemory = () => {
    const memoryConfig = getMemoryConfig();
    return Boolean(memoryConfig?.enabled || memoryConfig?.autoSummarize);
  };

  const insertSystemMessage = (
    messages: ChatInputMessage[],
    content: string
  ): ChatInputMessage[] => {
    if (!content.trim()) return messages;
    const insertIndex = messages.findIndex(message => message.role !== 'system');
    const headIndex = insertIndex === -1 ? messages.length : insertIndex;
    return [
      ...messages.slice(0, headIndex),
      { role: 'system', content },
      ...messages.slice(headIndex),
    ];
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

  const send = async (options: {
    providerType: string;
    model: string;
    messages: ChatTransportMessage[];
    tools?: string[]; // Optional specific tools to enable
    mcpServerIds?: string[];
    skillIds?: string[]; // Optional skill ids to inject into system prompt
    skillMode?: 'manual' | 'auto';
    threadId?: string;
  }) => {
    try {
      const modelMessages = await toModelInputMessages(options.messages);
      const lastModelMessage = modelMessages[modelMessages.length - 1];
      const realtimeContext = lastModelMessage
        ? await buildRealtimeAffectContext(options.threadId, getPromptFromMessage(lastModelMessage))
        : { message: '', state: null };
      const inputMessages = deps.memory.injectMemoryIntoMessages(modelMessages, options.threadId, {
        skipAffect: Boolean(realtimeContext.message),
      });
      const finalMessages = realtimeContext.message
        ? insertSystemMessage(inputMessages, realtimeContext.message)
        : inputMessages;

      const affectStateForPolicy =
        realtimeContext.state ?? getAffectStateForPolicy(options.threadId);
      const guardActive = shouldRequireGuardedTools(affectStateForPolicy);

      const { skillsSystemPrompt } = await resolveSkillsSystemPrompt({
        inputMessages: finalMessages,
        threadId: options.threadId,
        skillIds: options.skillIds,
        skillMode: options.skillMode,
      });

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

      if (guardedTools.length > 0) {
        const runner = createChatConversationRunner({
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of guardedTools) {
          registerToolWithGuard(runner, toolName, guardActive);
        }

        // Separate user prompt from history
        const history = finalMessages.slice(0, -1);
        const lastMessage = finalMessages[finalMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        runner.setModelMessages(history);
        const result = await runner.generate(prompt);
        return { success: true, text: result.response };
      }

      // Fallback to simple LLM call
      const text = await llmFactory.generateChat({
        providerType: options.providerType,
        modelId: options.model,
        messages: toLlmChatMessages(finalMessages),
        extraSystemPrompt: skillsSystemPrompt,
      });
      return { success: true, text };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const stream = async (
    webContents: ChatWebContents,
    options: {
      providerType: string;
      model: string;
      messages: ChatTransportMessage[];
      tools?: string[];
      mcpServerIds?: string[];
      skillIds?: string[];
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }
  ) => {
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
      const modelMessages = await toModelInputMessages(options.messages);
      const lastModelMessage = modelMessages[modelMessages.length - 1];
      const realtimeContext = lastModelMessage
        ? await buildRealtimeAffectContext(options.threadId, getPromptFromMessage(lastModelMessage))
        : { message: '', state: null };
      const inputMessages = deps.memory.injectMemoryIntoMessages(modelMessages, options.threadId, {
        onRetrieved: payload => {
          uiChunkEmitter.emitMemoryRetrieval(payload);
        },
        skipAffect: Boolean(realtimeContext.message),
      });
      const finalMessages = realtimeContext.message
        ? insertSystemMessage(inputMessages, realtimeContext.message)
        : inputMessages;

      const affectStateForPolicy =
        realtimeContext.state ?? getAffectStateForPolicy(options.threadId);
      const guardActive = shouldRequireGuardedTools(affectStateForPolicy);

      const { skillsSystemPrompt } = await resolveSkillsSystemPrompt({
        inputMessages: finalMessages,
        threadId: options.threadId,
        skillIds: options.skillIds,
        skillMode: options.skillMode,
      });

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

      const enableTools = guardedTools.length > 0;
      const systemPrompt = [enableTools ? TOOL_AGENT_SYSTEM_PROMPT : '', skillsSystemPrompt]
        .filter(Boolean)
        .join('\n\n');

      const runner = createChatConversationRunner({
        providerType: options.providerType,
        model: options.model,
        systemPrompt,
        enableTools,
        maxIterations: 5,
      });

      if (enableTools) {
        for (const toolName of guardedTools) {
          if (!defaultToolRegistry.get(toolName)) {
            console.warn(`[Main] Tool ${toolName} not found in registry`);
            continue;
          }
          registerToolWithGuard(runner, toolName, guardActive);
        }
      }

      if (!finalMessages || finalMessages.length === 0) {
        throw new Error('No messages provided for streaming');
      }

      const history = finalMessages.slice(0, -1);
      const lastMessage = finalMessages[finalMessages.length - 1];
      const prompt = getPromptFromMessage(lastMessage);

      if (!prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      runner.setModelMessages(history);
      const streamResult = await toolLoopRunner.stream({
        runner,
        webContents,
        prompt,
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
            });
          }
          uiChunkEmitter.emitToolEvent(eventPart);
        },
        abortSignal: streamState.abortController.signal,
        uiChunkEmitter,
      });
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
