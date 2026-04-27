import type { ConversationHarness } from '../../../core/agent';
import { createLogger } from '../../../core/logger';
import * as llmFactory from '../../../core/provider/llm/factory';
import { runWithToolRuntimeContext } from '../../../core/tools/runtime_context';
import { getErrorMessage } from '../../utils/errors';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveChatToolMaxIterations,
} from './chat_constants';
import type { ChatMemory } from './chat_memory';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import * as agentRunDb from '../../../core/db/agent_runs';
import { createAgentRunTracker } from './chat_run_tracking';
import {
  createApprovalRecoveryContext,
  createChatHarness,
  describeApprovalRequiredTools,
} from './chat_streaming_harness';
import { createChatStreamingModels } from './chat_streaming_models';
import { createChatTurnPreparer, type ChatTurnOptions } from './chat_turn_preparer';
import type { ActiveStreamState, ChatWebContents } from './chat_types';
import { createUiChunkEmitter, toLlmChatMessages } from './chat_ui';
import { createToolLoopRunner, type RegisterApprovalBatch } from './chat_tool_loop';
import { companionService } from '../companion/companion_service';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export type ChatSendResult =
  | {
      success: true;
      text: string;
      runId?: string;
    }
  | {
      success: false;
      error: string;
      runId?: string;
    };

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
    cleanupPendingSessionsForWebContents: (senderId: number) => void;
  };
}) => {
  const toolLoopRunner = createToolLoopRunner({
    registerApprovalBatch: deps.approvals.registerApprovalBatch,
  });
  const turnPreparer = createChatTurnPreparer({ memory: deps.memory });
  const streamingModels = createChatStreamingModels();

  const steerQueues = new Map<number, string[]>();

  const stopStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (!streamState) {
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    steerQueues.delete(senderId);
    return { success: true };
  };

  const steerStream = (senderId: number, message: string): { success: boolean; error?: string } => {
    const steerQueue = steerQueues.get(senderId);
    if (!steerQueue) {
      return { success: false, error: 'No active autonomous stream to steer' };
    }
    steerQueue.push(message);
    return { success: true };
  };

  const send = async (options: ChatTurnOptions): Promise<ChatSendResult> => {
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    try {
      const preparedTurn = await turnPreparer.prepareChatTurn(options);
      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);
      const systemPrompt = preparedTurn.enableTools
        ? TOOL_AGENT_SYSTEM_PROMPT
        : NO_TOOLS_SYSTEM_PROMPT;

      runTracker = createAgentRunTracker({
        kind: options.runConfig?.kind ?? 'chat-turn',
        threadId: options.threadId,
        parentRunId: options.runConfig?.parentRunId,
        rootRunId: options.runConfig?.rootRunId,
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

        const result = await runWithToolRuntimeContext(
          { runId: runTracker.id, runTracker },
          async () =>
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
        return {
          success: true,
          text: result.response,
          ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
        };
      }

      const llmResult = await llmFactory.generateChatWithUsage({
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
        usage: llmResult.usage,
        source: 'chat.send.llm',
        metadata: {
          contextTokens: preparedTurn.report.totalEstimatedTokens,
        },
      });
      runTracker.markCompleted({
        text: llmResult.text,
        usage: llmResult.usage ? { ...llmResult.usage } : undefined,
        finishReason: 'completed',
      });
      return {
        success: true,
        text: llmResult.text,
        ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (runTracker && runTracker.getRun().status === 'running') {
        runTracker.markFailed({ message });
      }
      return {
        success: false,
        error: message,
        ...(options.runConfig?.kind && runTracker ? { runId: runTracker.id } : {}),
      };
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
    const companionThinkingKey = `renderer:${senderId}:${Date.now().toString(36)}`;
    const uiChunkEmitter = createUiChunkEmitter(webContents);
    deps.activeStreams.set(senderId, streamState);
    const steerQueue: string[] = [];
    steerQueues.set(senderId, steerQueue);
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    try {
      const preparedTurn = await turnPreparer.prepareChatTurn({
        ...options,
        onMemoryRetrieved: payload => {
          uiChunkEmitter.emitMemoryRetrieval({
            query: payload.query,
            results: payload.results,
          });
        },
      });
      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);
      const autonomousMode = options.autonomous && options.autonomous.maxIterations > 1;
      const guardedTools = autonomousMode
        ? [...new Set([...preparedTurn.guardedTools, 'finish'])]
        : preparedTurn.guardedTools;

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

      companionService.setChatPolicy(preparedTurn.interventionPolicy);

      const systemPrompt = preparedTurn.enableTools
        ? TOOL_AGENT_SYSTEM_PROMPT
        : NO_TOOLS_SYSTEM_PROMPT;

      let streamHistory = preparedTurn.history;
      let streamPrompt = preparedTurn.prompt;

      if (options.runConfig?.kind === 'handoff-resume' && options.runConfig?.parentRunId) {
        const checkpoint = agentRunDb.getLatestAgentRunCheckpoint(options.runConfig.parentRunId);
        if (checkpoint?.snapshot?.working?.modelMessages) {
          const checkpointMessages = checkpoint.snapshot.working.modelMessages as import('ai').ModelMessage[];
          if (checkpointMessages.length > 0) {
            streamHistory = [
              {
                role: 'system' as const,
                content: `[HANDOFF CONTEXT] You are resuming work from a previous agent run. The conversation history below is from that run. Continue the work based on what was done before.`,
              },
              ...checkpointMessages,
              ...(preparedTurn.history.length > 0
                ? [
                    {
                      role: 'system' as const,
                      content: `[CURRENT THREAD] The following messages are from the current conversation thread:`,
                    } as import('ai').ModelMessage,
                    ...preparedTurn.history,
                  ]
                : []),
            ];
            streamPrompt = preparedTurn.prompt || 'Continue the work from where the previous agent left off.';
          }
        }
      }

      runTracker = createAgentRunTracker({
        kind: options.runConfig?.kind ?? 'chat-turn',
        threadId: options.threadId,
        parentRunId: options.runConfig?.parentRunId,
        rootRunId: options.runConfig?.rootRunId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enabledTools: guardedTools,
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
          modelMessages: streamHistory,
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
            enabledTools: guardedTools,
            availableSkillIds: preparedTurn.selectedSkillIds,
            ...(autonomousMode ? { autonomous: options.autonomous } : {}),
          })
        : undefined;

      const harness = createChatHarness({
        threadId: options.threadId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enableTools: preparedTurn.enableTools,
        enabledTools: guardedTools,
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

      companionService.beginThinking(companionThinkingKey);
      const streamResult = await runWithToolRuntimeContext(
        { runId: runTracker.id, runTracker },
        async () =>
          await toolLoopRunner.stream({
            harness,
            webContents,
            history: streamHistory,
            prompt: streamPrompt,
            approvalContext,
            autonomous: autonomousMode
              ? { maxIterations: options.autonomous!.maxIterations, continuePrompt: options.autonomous!.continuePrompt }
              : undefined,
            retry: autonomousMode
              ? { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000 }
              : { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
            steerQueue: autonomousMode ? steerQueue : undefined,
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
      } else if (streamResult.handoff) {
        const handoffResponse =
          (streamResult.response ? streamResult.response + '\n\n' : '') +
          `[Handoff] ${streamResult.handoff.summary}\n\nNext steps: ${streamResult.handoff.nextSteps}`;
        runTracker.markCompleted({
          text: handoffResponse.trim() || undefined,
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: 'handoff',
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
      companionService.endThinking(companionThinkingKey);
      deps.approvals.cleanupPendingSessionsForWebContents(senderId);
      steerQueues.delete(senderId);
      if (deps.activeStreams.get(senderId) === streamState) {
        deps.activeStreams.delete(senderId);
      }
    }
  };

  return {
    getModels: streamingModels.getModels,
    isProviderConfigured: streamingModels.isProviderConfigured,
    send,
    stream,
    stopStream,
    steerStream,
  };
};

export type ChatStreaming = ReturnType<typeof createChatStreaming>;
