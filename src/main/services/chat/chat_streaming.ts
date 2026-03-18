import { SimpleAgent } from '../../../core/agent';
import { getAppConfig } from '../../../core/config';
import * as chatThreadDb from '../../../core/db/chat_thread';
import * as emotionDb from '../../../core/db/emotion';
import * as memoryDb from '../../../core/db/memory';
import {
  buildAffectSystemMessage,
  collectEmotionSamples,
  computeAffectState,
} from '../../../core/emotion/affect_state';
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
  toAgentMessages,
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
      session: { agent: SimpleAgent; webContents: ChatWebContents }
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

  const buildRealtimeAffectMessage = async (
    threadId: string | undefined,
    prompt: string
  ): Promise<string> => {
    const emotionConfig = getEmotionConfig();
    if (
      !emotionConfig?.enabled ||
      !emotionConfig.injectToSystemPrompt ||
      !emotionConfig.realtimeAnalysis
    ) {
      return '';
    }

    const content = prompt.trim();
    if (!content) return '';

    const minSampleCount = Math.max(1, Math.floor(emotionConfig.minSampleCount || 1));
    if (!threadId && minSampleCount > 1) return '';

    if (threadId) {
      const thread = chatThreadDb.getChatThread(threadId);
      if (thread?.is_incognito) return '';
    }

    const emotion = await analyzeEmotionWithAgent(content);
    if (!emotion) return '';

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

    const fetchLimit = Math.max(
      10,
      Math.floor(emotionConfig.windowSize || 0) * 3,
      minSampleCount
    );

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

    if (!affectState) return '';
    return buildAffectSystemMessage(affectState);
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
      console.log(`[StreamDebug][Main][${senderId}] stop-stream ignored: no active stream`);
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    console.log(`[StreamDebug][Main][${senderId}] stop-stream acknowledged`);
    return { success: true };
  };

  const send = async (options: {
    providerType: string;
    model: string;
    messages: ChatTransportMessage[];
    tools?: string[]; // Optional specific tools to enable
    skillIds?: string[]; // Optional skill ids to inject into system prompt
    skillMode?: 'manual' | 'auto';
    threadId?: string;
  }) => {
    try {
      const modelMessages = await toModelInputMessages(options.messages);
      const lastModelMessage = modelMessages[modelMessages.length - 1];
      const realtimeAffect = lastModelMessage
        ? await buildRealtimeAffectMessage(options.threadId, getPromptFromMessage(lastModelMessage))
        : '';
      const inputMessages = deps.memory.injectMemoryIntoMessages(
        modelMessages,
        options.threadId,
        { skipAffect: Boolean(realtimeAffect) }
      );
      const finalMessages = realtimeAffect
        ? insertSystemMessage(inputMessages, realtimeAffect)
        : inputMessages;

      const { skillsSystemPrompt } = await resolveSkillsSystemPrompt({
        inputMessages: finalMessages,
        threadId: options.threadId,
        skillIds: options.skillIds,
        skillMode: options.skillMode,
      });

      const { resolvedTools, mode } = await resolveToolNames({
        tools: options.tools,
      });

      persistThreadRuntimeHints({
        threadId: options.threadId ?? '',
        providerType: options.providerType,
        model: options.model,
        tools: resolvedTools,
      });

      if (resolvedTools.length > 0) {
        // Use Agent when tools are enabled for this request
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'), // Persona is already integrated in SimpleAgent
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of resolvedTools) {
          const tool = defaultToolRegistry.get(toolName);
          if (tool) agent.registerTool(tool);
        }

        if (mode === 'auto') {
          console.log('[Main] send(): auto-enabled tools:', resolvedTools);
        }

        // Separate user prompt from history
        const history = finalMessages.slice(0, -1);
        const lastMessage = finalMessages[finalMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        agent.setMessages(toAgentMessages(history));
        const result = await agent.generate(prompt);
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
      skillIds?: string[];
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }
  ) => {
    const senderId = webContents.id;
    const streamDebugId = `${senderId}-${Date.now()}`;
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
    const streamStartedAt = Date.now();
    console.log(
      `[StreamDebug][Main][${streamDebugId}] start provider=${options.providerType} model=${options.model} messageCount=${options.messages?.length ?? 0} toolCount=${options.tools?.length ?? 0}`
    );

    try {
      const modelMessages = await toModelInputMessages(options.messages);
      const lastModelMessage = modelMessages[modelMessages.length - 1];
      const realtimeAffect = lastModelMessage
        ? await buildRealtimeAffectMessage(options.threadId, getPromptFromMessage(lastModelMessage))
        : '';
      const inputMessages = deps.memory.injectMemoryIntoMessages(
        modelMessages,
        options.threadId,
        {
          onRetrieved: payload => {
            uiChunkEmitter.emitMemoryRetrieval(payload);
          },
          skipAffect: Boolean(realtimeAffect),
        }
      );
      const finalMessages = realtimeAffect
        ? insertSystemMessage(inputMessages, realtimeAffect)
        : inputMessages;

      const { skillsSystemPrompt } = await resolveSkillsSystemPrompt({
        inputMessages: finalMessages,
        threadId: options.threadId,
        skillIds: options.skillIds,
        skillMode: options.skillMode,
      });

      const { resolvedTools, mode } = await resolveToolNames({
        tools: options.tools,
      });

      persistThreadRuntimeHints({
        threadId: options.threadId ?? '',
        providerType: options.providerType,
        model: options.model,
        tools: resolvedTools,
      });

      const enableTools = resolvedTools.length > 0;
      const systemPrompt = [enableTools ? TOOL_AGENT_SYSTEM_PROMPT : '', skillsSystemPrompt]
        .filter(Boolean)
        .join('\n\n');

      const agent = new SimpleAgent({
        enabled: true,
        providerType: options.providerType,
        model: options.model,
        systemPrompt,
        enableTools,
        maxIterations: 5,
      });

      if (enableTools) {
        console.log(
          '[Main] Streaming chat with tools:',
          resolvedTools,
          mode === 'manual' ? '(manual)' : '(auto)'
        );

        for (const toolName of resolvedTools) {
          const tool = defaultToolRegistry.get(toolName);
          console.log(`[Main] Registering tool: ${toolName}`, tool ? 'found' : 'not found');
          if (tool) {
            agent.registerTool(tool);
          } else {
            console.warn(`[Main] Tool ${toolName} not found in registry`);
          }
        }

        console.log('[Main] Registered tools count:', agent.getTools().length);
      } else {
        console.log('[Main] Streaming chat without tools');
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

      agent.setMessages(toAgentMessages(history));
      const streamResult = await toolLoopRunner.stream({
        agent,
        webContents,
        prompt,
        shouldCancel: () => streamState.cancelled,
        debugLabel: streamDebugId,
        onToolEvent: eventPart => {
          if (
            eventPart.type === 'tool-approval-request' &&
            typeof eventPart.approvalId === 'string' &&
            eventPart.approvalId.length > 0
          ) {
            deps.approvals.ensurePendingApprovalSession(eventPart.approvalId, { agent, webContents });
          }
          uiChunkEmitter.emitToolEvent(eventPart);
        },
        abortSignal: streamState.abortController.signal,
        uiChunkEmitter,
      });
      console.log(
        `[StreamDebug][Main][${streamDebugId}] complete mode=agent stopped=${streamState.stoppedByUser} awaitingApproval=${streamResult.awaitingApproval ?? false} durationMs=${Date.now() - streamStartedAt}`
      );
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        console.log(
          `[StreamDebug][Main][${streamDebugId}] cancelled-in-catch durationMs=${Date.now() - streamStartedAt}`
        );
        uiChunkEmitter.abort();
        return { success: true, stopped: streamState.stoppedByUser };
      }
      const message = getErrorMessage(error);
      console.error(
        `[StreamDebug][Main][${streamDebugId}] error=${message} durationMs=${Date.now() - streamStartedAt}`
      );
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
