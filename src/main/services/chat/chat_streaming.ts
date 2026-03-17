import type { ToolApprovalResponse } from 'ai';

import { SimpleAgent, type AgentResult } from '../../../core/agent';
import * as llmFactory from '../../../core/provider/llm/factory';
import * as deepseekProvider from '../../../core/provider/llm/deepseek';
import * as kimiProvider from '../../../core/provider/llm/kimi';
import * as openaiProvider from '../../../core/provider/llm/openai';
import { defaultToolRegistry } from '../../../core/tools';
import { getErrorMessage } from '../../utils/errors';
import { shouldLogChunk, TOOL_AGENT_SYSTEM_PROMPT } from './chat_constants';
import type { ChatMemory } from './chat_memory';
import { resolveSkillsSystemPrompt } from './chat_skills';
import { persistThreadRuntimeHints } from './chat_thread_hints';
import { resolveToolNames } from './chat_tools';
import type {
  ActiveStreamState,
  ChatTransportMessage,
  ChatWebContents,
  ToolStreamEvent,
  UiChunkEmitter,
} from './chat_types';
import {
  createUiChunkEmitter,
  getPromptFromMessage,
  toAgentMessages,
  toLlmChatMessages,
  toModelInputMessages,
} from './chat_ui';

export type RegisterApprovalBatch = (
  approvalRequests: Array<{ approvalId: string }>,
  session: { agent: SimpleAgent; webContents: ChatWebContents }
) => void;

export const streamAgentResponse = async (params: {
  agent: SimpleAgent;
  webContents: ChatWebContents;
  prompt: string;
  approvalResponses?: ToolApprovalResponse[];
  shouldCancel?: () => boolean;
  debugLabel?: string;
  onToolEvent?: (event: ToolStreamEvent) => void;
  abortSignal?: AbortSignal;
  uiChunkEmitter?: UiChunkEmitter;
  registerApprovalBatch: RegisterApprovalBatch;
}) => {
  const generator = params.agent.stream(
    params.prompt,
    params.approvalResponses,
    params.onToolEvent,
    params.abortSignal
  );
  let fullResponse = '';
  let chunkCount = 0;
  let chunkChars = 0;
  const startedAt = Date.now();
  let cancelled = false;
  let next: IteratorResult<string, AgentResult> | null = null;

  try {
    next = await generator.next();
    while (!next.done) {
      if (params.shouldCancel?.()) {
        cancelled = true;
        try {
          await generator.return(undefined);
        } catch (error) {
          console.warn('[Main] Failed to close cancelled tool stream:', error);
        }
        break;
      }

      const chunk = next.value;
      if (typeof chunk === 'string' && chunk) {
        chunkCount += 1;
        chunkChars += chunk.length;
        if (params.debugLabel && shouldLogChunk(chunkCount)) {
          console.log(
            `[StreamDebug][Main][Agent][${params.debugLabel}] chunk#${chunkCount} len=${chunk.length} totalChars=${chunkChars}`
          );
        }
        fullResponse += chunk;
        params.uiChunkEmitter?.emitTextDelta(chunk);
      }
      next = await generator.next();
    }
  } catch (error) {
    if (params.shouldCancel?.() || (error instanceof Error && error.name === 'AbortError')) {
      cancelled = true;
      try {
        await generator.return(undefined);
      } catch (returnError) {
        console.warn('[Main] Failed to close aborted tool stream:', returnError);
      }
    } else {
      params.uiChunkEmitter?.error(getErrorMessage(error));
      throw error;
    }
  }

  if (cancelled || !next) {
    if (params.debugLabel) {
      console.log(
        `[StreamDebug][Main][Agent][${params.debugLabel}] cancelled chunkCount=${chunkCount} totalChars=${chunkChars} durationMs=${Date.now() - startedAt}`
      );
    }
    params.uiChunkEmitter?.abort();
    return { awaitingApproval: false, cancelled: true };
  }

  const agentResult = (next.value ?? null) as AgentResult | null;
  let finalText = fullResponse;
  if (agentResult?.response && agentResult.response.trim()) {
    finalText = agentResult.response;
  }

  if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
    params.registerApprovalBatch(agentResult.toolApprovalRequests, {
      agent: params.agent,
      webContents: params.webContents,
    });
    return { awaitingApproval: true };
  }

  if (!finalText.trim() && fullResponse.trim()) {
    finalText = fullResponse;
  }

  if (params.debugLabel) {
    console.log(
      `[StreamDebug][Main][Agent][${params.debugLabel}] done chunkCount=${chunkCount} totalChars=${chunkChars} finalTextLen=${(finalText || '').length} durationMs=${Date.now() - startedAt}`
    );
  }
  params.uiChunkEmitter?.finish();
  return { awaitingApproval: false };
};

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
      const inputMessages = deps.memory.injectMemoryIntoMessages(
        await toModelInputMessages(options.messages),
        options.threadId
      );

      const { skillsSystemPrompt } = await resolveSkillsSystemPrompt({
        inputMessages,
        threadId: options.threadId,
        skillIds: options.skillIds,
        skillMode: options.skillMode,
      });

      if (options.tools && options.tools.length > 0) {
        // Use Agent if tools are specified
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'), // Persona is already integrated in SimpleAgent
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of options.tools) {
          const tool = defaultToolRegistry.get(toolName);
          if (tool) agent.registerTool(tool);
        }

        // Separate user prompt from history
        const history = inputMessages.slice(0, -1);
        const lastMessage = inputMessages[inputMessages.length - 1];
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
        messages: toLlmChatMessages(inputMessages),
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
    let partialResponse = '';
    let llmChunkCount = 0;
    const streamStartedAt = Date.now();
    console.log(
      `[StreamDebug][Main][${streamDebugId}] start provider=${options.providerType} model=${options.model} messageCount=${options.messages?.length ?? 0} toolCount=${options.tools?.length ?? 0}`
    );

    try {
      const inputMessages = deps.memory.injectMemoryIntoMessages(
        await toModelInputMessages(options.messages),
        options.threadId,
        {
          onRetrieved: payload => {
            uiChunkEmitter.emitMemoryRetrieval(payload);
          },
        }
      );

      const { skillsSystemPrompt } = await resolveSkillsSystemPrompt({
        inputMessages,
        threadId: options.threadId,
        skillIds: options.skillIds,
        skillMode: options.skillMode,
      });

      const { resolvedTools, mode } = await resolveToolNames({ tools: options.tools });

      persistThreadRuntimeHints({
        threadId: options.threadId ?? '',
        providerType: options.providerType,
        model: options.model,
        tools: resolvedTools,
      });

      if (resolvedTools.length > 0) {
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
          enableTools: true,
          maxIterations: 5,
        });

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

        if (!inputMessages || inputMessages.length === 0) {
          throw new Error('No messages provided for streaming');
        }

        const history = inputMessages.slice(0, -1);
        const lastMessage = inputMessages[inputMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled stream');
        }

        agent.setMessages(toAgentMessages(history));
        const streamResult = await streamAgentResponse({
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
          registerApprovalBatch: deps.approvals.registerApprovalBatch,
        });
        console.log(
          `[StreamDebug][Main][${streamDebugId}] complete mode=agent stopped=${streamState.stoppedByUser} awaitingApproval=${streamResult.awaitingApproval ?? false} durationMs=${Date.now() - streamStartedAt}`
        );
        return {
          success: true,
          awaitingApproval: streamResult.awaitingApproval,
          stopped: streamState.stoppedByUser,
        };
      }

      const result = await llmFactory.streamChat(
        {
          providerType: options.providerType,
          modelId: options.model,
          messages: toLlmChatMessages(inputMessages),
          extraSystemPrompt: skillsSystemPrompt,
        },
        chunk => {
          if (streamState.cancelled) return;
          partialResponse += chunk;
          llmChunkCount += 1;
          if (shouldLogChunk(llmChunkCount)) {
            console.log(
              `[StreamDebug][Main][${streamDebugId}] chunk#${llmChunkCount} len=${chunk.length} totalChars=${partialResponse.length}`
            );
          }
          uiChunkEmitter.emitTextDelta(chunk);
        },
        () => streamState.cancelled,
        streamState.abortController.signal
      );
      const finalText = streamState.cancelled ? partialResponse : result;
      console.log(
        `[StreamDebug][Main][${streamDebugId}] complete mode=llm stopped=${streamState.stoppedByUser} chunkCount=${llmChunkCount} partialLen=${partialResponse.length} finalLen=${(finalText || '').length} durationMs=${Date.now() - streamStartedAt}`
      );
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
      } else {
        uiChunkEmitter.finish();
      }
      return { success: true, stopped: streamState.stoppedByUser };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        console.log(
          `[StreamDebug][Main][${streamDebugId}] cancelled-in-catch chunkCount=${llmChunkCount} partialLen=${partialResponse.length} durationMs=${Date.now() - streamStartedAt}`
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
