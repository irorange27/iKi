import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { getStreamErrorMessage } from '@iki/backend/utils/errors';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveToolCallMaxIterations,
} from './constants';
import type { ChatMemory } from './memory';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from '../turn_prep/approval_types';
import { createApprovalRecoveryContext } from '../turn_prep/approval_types';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createAgentRunTracker } from '../turn_prep/run_tracker';
import { startTurnHarness } from '../agent/harness';
import { createChatStreamingModels } from './models';
import { createChatTurnPreparer, type ChatTurnOptions } from '../turn_prep/turn_preparer';
import { createMessageSend } from './message_send';
import { buildHandoffResumeContext } from './handoff_resume';
export type { MessageSendResult } from './message_send';
import type { ActiveStreamState, ChatStreamTarget, RunStatusEvent } from './types';
import { createUiChunkEmitter } from './ui_stream';
import { getCompanion } from './platform';
import { getPersonalityStylePrompt } from '../message/personality';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import type { ThreadStreamCoordinator } from './thread_stream_coordinator';
import { runOuterLoop, type OuterLoopState } from './outer_loop';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export const createChatStreaming = (deps: {
  streamCoordinator: ThreadStreamCoordinator;
  memory: ChatMemory;
  getThreadTitle?: (threadId: string) => string | undefined;
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
        target: ChatStreamTarget;
        history?: import('ai').ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
    cleanupPendingSessionsForSender: (senderId: number) => void;
  };
}) => {
  const turnPreparer = createChatTurnPreparer({
    memory: deps.memory,
    getRuntimeConfig: () => {
      try {
        const config = getAppConfig();
        return {
          emotion: config?.memory?.emotion || null,
          autoApproveToolRequests: config?.general?.autoApproveToolRequests === true,
          memoryContext: config?.memory?.context ?? null,
        };
      } catch {
        return { emotion: null, autoApproveToolRequests: false, memoryContext: null };
      }
    },
  });
  const streamingModels = createChatStreamingModels();
  const coordinator = deps.streamCoordinator;

  const { send } = createMessageSend({
    turnPreparer,
    usage: deps.usage,
    checkThreadRunRate: coordinator.checkThreadRunRate,
  });

  const stream = async (target: ChatStreamTarget, options: ChatTurnOptions) => {
    const senderId = target.id;
    coordinator.supersedeActiveStream(senderId);

    const uiChunkEmitter = createUiChunkEmitter(target);

    if (options.threadId) {
      const rateCheck = coordinator.checkThreadRunRate(options.threadId);
      if (!rateCheck.allowed) {
        const delaySec = Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000);
        uiChunkEmitter.error(`Too many requests on this thread. Retry in ${delaySec}s.`);
        return { success: false, error: `Too many requests on this thread. Retry in ${delaySec}s.` };
      }
    }

    if (options.threadId) {
      coordinator.cancelThreadStreams(options.threadId, senderId);
      coordinator.trackThreadStream(options.threadId, senderId);
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const companionThinkingKey = `renderer:${senderId}:${Date.now().toString(36)}`;
    coordinator.registerStream(senderId, streamState);

    // Mutable loop state; runOuterLoop drives it across batches while this
    // scope owns setup, finalization, and cleanup. Declared before the try so
    // catch/finally and notifyRunStatus always read the latest run.
    let state: OuterLoopState | null = null;
    const notifyRunStatus = () => {
      const run = state?.runTracker?.getRun();
      if (!run) return;
      target.send('chat:run-status', {
        runId: run.id,
        status: run.status,
        threadId: run.threadId,
        timestamp: run.updatedAt,
      } satisfies RunStatusEvent);
    };

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
      const maxIterations = resolveToolCallMaxIterations(options.maxIterations);
      const autonomousMode = options.autonomous && options.autonomous.maxIterations > 1;
      const guardedTools = preparedTurn.guardedTools;

      if (preparedTurn.usedSkills.length > 0) {
        uiChunkEmitter.emitSkillUsage({
          mode: preparedTurn.skillMode,
          skills: preparedTurn.usedSkills.map(skill => ({
            id: skill.id,
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
          })),
        });
      }

      if (preparedTurn.affectSignal) {
        uiChunkEmitter.emitAffectSignal(preparedTurn.affectSignal);
      }

      getCompanion().setChatPolicy(preparedTurn.interventionPolicy);
      const affectState = preparedTurn.affectSignal?.state;
      if (affectState && affectState.valence !== undefined && affectState.arousal !== undefined) {
        getCompanion().setAffect({
          label: affectState.label,
          valence: affectState.valence,
          arousal: affectState.arousal,
        });
      } else {
        getCompanion().setAffect(null);
      }

      const approvalPolicy = parseApprovalPolicy(options.approvalPolicy);

      const systemPrompt = [
        preparedTurn.enableTools ? TOOL_AGENT_SYSTEM_PROMPT : NO_TOOLS_SYSTEM_PROMPT,
        getPersonalityStylePrompt(options.personality),
      ]
        .filter(part => part.trim().length > 0)
        .join('\n\n');

      let streamHistory = preparedTurn.history;
      let streamPrompt = preparedTurn.prompt;

      if (options.runConfig?.kind === 'handoff-resume' && options.runConfig?.parentRunId) {
        const parentRun = agentRunDb.getAgentRun(options.runConfig.parentRunId);
        const handoffResume = buildHandoffResumeContext({
          parentRun,
          preparedHistory: preparedTurn.history,
          preparedPrompt: preparedTurn.prompt,
        });
        if (handoffResume) {
          streamHistory = handoffResume.history;
          streamPrompt = handoffResume.prompt;
        }
      }

      const runTracker = createAgentRunTracker({
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
            approvalPolicy,
            requireApproval: preparedTurn.requireApproval,
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
      streamState.runId = runTracker.id;

      const approvalContext = preparedTurn.enableTools
        ? createApprovalRecoveryContext({
            threadId: options.threadId,
            sessionId: uiChunkEmitter.messageId,
            runId: runTracker.id,
            providerType: options.providerType,
            providerId: options.providerId,
            model: options.model,
            systemPrompt,
            maxOutputTokens: preparedTurn.maxOutputTokens,
            maxInputTokens: preparedTurn.maxInputTokens,
            maxIterations,
            requireApproval: preparedTurn.requireApproval,
            enabledTools: guardedTools,
            availableSkillIds: preparedTurn.selectedSkillIds,
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
            ...(approvalPolicy ? { approvalPolicy } : {}),
            ...(autonomousMode ? { autonomous: options.autonomous } : {}),
          })
        : undefined;

      const harness = startTurnHarness({
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enableTools: preparedTurn.enableTools,
        enabledToolNames: guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        guardActive: preparedTurn.guardActive,
        requireApproval: preparedTurn.requireApproval,
        autoApproveToolRequests: preparedTurn.autoApproveToolRequests,
        maxIterations,
        threadId: options.threadId,
        maxOutputTokens: preparedTurn.maxOutputTokens,
        maxInputTokens: preparedTurn.maxInputTokens,
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(approvalPolicy ? { approvalPolicy } : {}),
      });

      if (!preparedTurn.prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      getCompanion().beginThinking(companionThinkingKey);

      const loopState: OuterLoopState = {
        harness,
        runTracker,
        approvalContext,
        streamHistory,
        streamPrompt,
        accumulatedResponse: '',
        outerBatch: 0,
        handoffChain: 0,
        turnHadToolCalls: false,
        isAwaitingApproval: false,
      };
      state = loopState;

      const streamResult = await runOuterLoop(loopState, {
        target,
        options,
        preparedTurn,
        maxIterations,
        autonomousMode: Boolean(autonomousMode),
        systemPrompt,
        streamState,
        uiChunkEmitter,
        notifyRunStatus,
        drainSteerMessages: () => coordinator.takeSteerMessages(senderId),
        approvals: deps.approvals,
      });

      if (!streamResult) {
        throw new Error('Unreachable: stream loop produced no result');
      }

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
            ...(loopState.outerBatch > 0 ? { autonomousBatches: loopState.outerBatch + 1 } : {}),
          },
        });

        // Attach the turn's usage + perf metrics to the assistant message so
        // the renderer can aggregate session stats (and persist them with the
        // message). Must run before finish()/abort() terminates the emitter.
        uiChunkEmitter.emitTokenUsage({
          ...(streamResult.usage ?? {}),
          maxInputTokens: preparedTurn.maxInputTokens,
          maxOutputTokens: preparedTurn.maxOutputTokens,
          model: options.model,
          providerType: options.providerType,
          ...(options.providerId ? { providerId: options.providerId } : {}),
          ...(streamResult.perf ?? {}),
        });
      }

      const finalResponse = loopState.accumulatedResponse || streamResult.response;

      if (streamResult.cancelled) {
        loopState.runTracker.markCancelled({
          ...(finalResponse ? { text: finalResponse } : {}),
        });
        notifyRunStatus();
      } else if (streamResult.partialFailure) {
        loopState.runTracker.markFailed({
          message: 'Autonomous iteration failed; partial progress saved.',
          retryable: true,
        });
        notifyRunStatus();
      } else if (streamResult.awaitingApproval) {
        loopState.runTracker.markBlocked({
          ...(finalResponse ? { text: finalResponse } : {}),
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
        });
        notifyRunStatus();
      } else if (streamResult.handoff) {
        const handoffResponse =
          (finalResponse ? finalResponse + '\n\n' : '') +
          `[Handoff] ${streamResult.handoff.summary}\n\nNext steps: ${streamResult.handoff.nextSteps}`;
        loopState.runTracker.markCompleted({
          text: handoffResponse.trim() || undefined,
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: 'handoff',
        });
        notifyRunStatus();
      } else {
        loopState.runTracker.markCompleted({
          ...(finalResponse ? { text: finalResponse } : {}),
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: streamResult.finished ? 'completed' : 'completed',
        });
        notifyRunStatus();
      }
      if (!streamResult.awaitingApproval) {
        uiChunkEmitter.finish();
      }
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        ...(finalResponse ? { text: finalResponse } : {}),
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (state?.runTracker && state.runTracker.getRun().status === 'running') {
          state.runTracker.markCancelled();
          notifyRunStatus();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }

      const message = getStreamErrorMessage(error);
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
      if (state?.runTracker && state.runTracker.getRun().status === 'running') {
        state.runTracker.markFailed({ message });
        notifyRunStatus();
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      getCompanion().clearConversationPreview();
      getCompanion().endThinking(companionThinkingKey);
      if (state?.turnHadToolCalls && !streamState.cancelled) {
        const threadLabel =
          options.threadId ? deps.getThreadTitle?.(options.threadId) : undefined;
        getCompanion().notifyReplyComplete(threadLabel);
      }
      if (!state?.isAwaitingApproval) {
        deps.approvals.cleanupPendingSessionsForSender(senderId);
      }
      if (options.threadId) {
        coordinator.untrackThreadStream(options.threadId, senderId);
      }
      coordinator.unregisterStream(senderId, streamState);
    }
  };

  return {
    getModels: streamingModels.getModels,
    getAcpAuthMethods: streamingModels.getAcpAuthMethods,
    isProviderConfigured: streamingModels.isProviderConfigured,
    send,
    stream,
    stopStream: coordinator.stopStream,
    steerStream: coordinator.steerStream,
  };
};

export type ChatStreaming = ReturnType<typeof createChatStreaming>;
