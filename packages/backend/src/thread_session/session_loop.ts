import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { getStreamErrorMessage } from '@iki/backend/utils/errors';
import type { ChatMemory } from './memory';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import { createApprovalRecoveryContext } from './approval_types';
import {
  assembleExecutionPlan,
  planToHarnessConfig,
  planToRunTrackerParams,
} from './execution_plan';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createAgentRunTracker } from './run_tracker';
import { summarizeContextComposition } from '../turn_prep/context_helpers';
import { startTurnHarness } from '../agent/harness';
import { createChatStreamingModels } from './models';
import { createChatTurnPreparer, type ChatTurnOptions } from '../turn_prep/turn_preparer';
import { createMessageSend } from './message_send';
import { buildHandoffResumeContext } from './handoff_resume';
export type { MessageSendResult } from './message_send';
import type { ActiveStreamState, ChatStreamTarget, RunStatusEvent } from './types';
import { createUiChunkEmitter } from './ui_stream';
import {
  getCompanion,
  getAssistantProfileContextMessage,
  retrieveRelevantContinuity,
} from './platform';
import { resolveSkillsSystemPrompt } from './skills';
import { resolveThreadWorkspaceSelectionSnapshot } from '../workspaces/thread_workspace';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import { writeThreadTodoPlan } from '../db/thread_todos';
import {
  persistAssistantTurnMessage,
  persistUserTurnMessage,
  pickUserTurnMessage,
} from './turn_persistence';
import {
  asChatUiMessage,
  recordSessionEvents,
  turnFactsToEvents,
} from './session_log';
import type { UiChunkEmitter } from './types';
import type { ThreadStreamCoordinator } from './thread_stream_coordinator';
import { createTurnDriver, finalizeRunForOutcome, runFailureFromError, type TurnDriverHandle } from './outer_loop';

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
  conversation: {
    createMessage: (input: unknown) => unknown;
    upsertTurnMessage: (input: unknown) => unknown;
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
    cleanupPendingSessionsForSender: (senderId: number, sessionId?: string) => void;
  };
}) => {
  const turnPreparer = createChatTurnPreparer({
    memory: deps.memory,
    resolveSkillsSystemPrompt,
    getAssistantProfileContextMessage,
    retrieveRelevantContinuity,
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
    tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
    conversation: deps.conversation,
    approvals: {
      ensurePendingApprovalSession: deps.approvals.ensurePendingApprovalSession,
      registerApprovalBatch: deps.approvals.registerApprovalBatch,
    },
  });

  const stream = async (target: ChatStreamTarget, options: ChatTurnOptions) => {
    const senderId = target.id;
    // Lease-loss must reach this execution even though the stream also rides
    // the thread-membership path; the hook is the uniform handle all three
    // entries share. The controller is wired within this synchronous block,
    // so a heartbeat callback cannot fire in the gap.
    const executionAbort: { current: (() => void) | null } = { current: null };
    const release = coordinator.tryAcquireThreadRun(options.threadId, {
      onExecutionAbort: () => executionAbort.current?.(),
    });
    if (!release) return { success: false, error: 'A turn is already running on this thread.' };

    const uiChunkEmitter = createUiChunkEmitter(target);

    if (options.threadId) {
      const rateCheck = coordinator.checkThreadRunRate(options.threadId);
      if (!rateCheck.allowed) {
        const delaySec = Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000);
        release();
        uiChunkEmitter.error(`Too many requests on this thread. Retry in ${delaySec}s.`);
        return { success: false, error: `Too many requests on this thread. Retry in ${delaySec}s.` };
      }
    }

    const userTurnMessageId = persistUserTurnMessage(deps.conversation, options);

    coordinator.supersedeActiveStream(senderId);
    if (options.threadId) {
      coordinator.cancelThreadStreams(options.threadId, senderId);
      coordinator.trackThreadStream(options.threadId, senderId);
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    executionAbort.current = () => {
      streamState.cancelled = true;
      streamState.abortController.abort('thread-lease-lost');
    };
    const companionThinkingKey = `renderer:${senderId}:${Date.now().toString(36)}`;
    coordinator.registerStream(senderId, streamState);

    let driver: TurnDriverHandle | null = null;
    // The run tracker exists before the driver does; a failure in the
    // pre-driver window must still record the turn's terminal fact.
    let sessionLogTracker: import('./run_tracker').AgentRunTracker | null = null;
    // Set once the settle/abort persist runs: late progress writes must not
    // follow it (the per-message chain serializes, this bounds the ordering).
    let turnPersistFinalized = false;
    const notifyRunStatus = () => {
      const run = driver?.getRunTracker().getRun();
      if (!run) return;
      target.send('chat:run-status', {
        runId: run.id,
        status: run.status,
        threadId: run.threadId,
        timestamp: run.updatedAt,
      } satisfies RunStatusEvent);
    };

    try {
      // Turn-start workspace binding (D30), resolved at admission — it stays
      // synchronous and ahead of every await (preparation, memory retrieval),
      // so a mid-turn switch cannot be observed. It sits inside the try so a
      // failing resolution (broken workspace directory, profile error) flows
      // through the cleanup path and releases the admission instead of
      // stranding the thread's in-memory guard and SQLite lease. The plan,
      // the executing harness world, the context projection and the approval
      // recovery context all share this one snapshot. Resumed turns (retry,
      // queued resume, blocked resume) carry their original world in the
      // options and rebind it — they are the same turn, not a new one.
      const turnStartWorkspace =
        options.workspaceSelection !== undefined
          ? options.workspaceSelection
          : resolveThreadWorkspaceSelectionSnapshot(options.threadId);
      const preparedTurn = await turnPreparer.prepareChatTurn({
        ...options,
        workspaceSelection: turnStartWorkspace,
        onMemoryRetrieved: payload => {
          uiChunkEmitter.emitMemoryRetrieval({
            query: payload.query,
            results: payload.results,
          });
        },
      });
      streamState.abortController.signal.throwIfAborted();
      const autonomousMode = options.autonomous && options.autonomous.maxIterations > 1;

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
      if (preparedTurn.enableTools && !approvalPolicy && !preparedTurn.requireApproval) {
        // The legacy fallback below auto-runs workspace writes for tool turns
        // with no policy; that is exactly how a frontend wiring gap silently
        // became "approvals never asked" once. Make the degradation loud.
        chatStreamingLogger.event({
          level: 'warn',
          event: 'chat.stream.approval_policy',
          outcome: 'degraded',
          entity: { thread_id: options.threadId || null },
          message:
            'Tool-enabled turn started without an explicit approval policy; legacy defaults may auto-run workspace writes.',
          data: { hint: 'The composer should send approvalPolicy (ChatInput approvalPolicy prop).' },
        });
      }

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

      // Turn-start workspace binding (D30): the plan is the single definition
      // of this execution — harness config, run-row identity/metadata and the
      // approval recovery context below are all derived from it.
      const plan = assembleExecutionPlan({
        options,
        preparedTurn,
        transport: 'stream',
        workspaceSelection: turnStartWorkspace,
      });

      const runTracker = createAgentRunTracker(
        planToRunTrackerParams(plan, {
          input: {
            ...(preparedTurn.prompt.trim() ? { prompt: preparedTurn.prompt } : {}),
            messages: preparedTurn.finalMessages,
          },
          working: {
            modelMessages: streamHistory,
            accumulatedText: '',
            pendingApprovalIds: [],
            lastStepIndex: 0,
          },
          metadataExtras: { assistantMessageId: uiChunkEmitter.messageId },
        })
      );
      streamState.runId = runTracker.id;
      sessionLogTracker = runTracker;

      // Session log: the accepted input and the turn's frozen plan are
      // business facts, recorded before execution begins (stage C slice 1 —
      // migration period, degrades to a warning on failure).
      const userTurnInput = pickUserTurnMessage(options);
      const acceptedInput =
        userTurnInput && asChatUiMessage(userTurnInput.message)
          ? { messageId: userTurnInput.messageId, message: asChatUiMessage(userTurnInput.message)! }
          : undefined;
      recordSessionEvents(options.threadId ?? '', turnFactsToEvents({
        ...(acceptedInput ? { input: acceptedInput } : {}),
        started: { runId: runTracker.id, kind: plan.kind, plan },
      }));

      const approvalContext = preparedTurn.enableTools
        ? createApprovalRecoveryContext({
            plan,
            sessionId: uiChunkEmitter.messageId,
            runId: runTracker.id,
          })
        : undefined;

      const harness = startTurnHarness(planToHarnessConfig(plan));

      if (!preparedTurn.prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      getCompanion().beginThinking(companionThinkingKey);

      // ponytail: clear stale todo plan from previous turn before starting fresh
      writeThreadTodoPlan({ threadId: options.threadId, items: [] });

      // Trailing debounce mirrors the write profile the renderer's old
      // mid-turn persist had; the settle write always supersedes the last one.
      let progressTimer: ReturnType<typeof setTimeout> | null = null;
      let progressPending = false;
      const persistTurnProgress = () => {
        if (!options.threadId || turnPersistFinalized) return;
        progressPending = true;
        if (progressTimer) return;
        progressTimer = setTimeout(() => {
          progressTimer = null;
          if (!progressPending || turnPersistFinalized) return;
          progressPending = false;
          void uiChunkEmitter.buildPersistedMessage().then(persisted => {
            // The reduce started before the check above; the settle may have
            // finalized while it ran. Re-check before enqueueing so a late
            // progress write cannot follow the settle upsert.
            if (!persisted || turnPersistFinalized) return;
            return persistAssistantTurnMessage(
              deps.conversation,
              options.threadId as string,
              persisted,
              'stream-progress',
              userTurnMessageId
            );
          });
        }, 300);
      };
      const activeDriver = createTurnDriver({
        harness,
        runTracker,
        approvalContext,
        streamHistory,
        streamPrompt,
        workspaceSelectionBox: { selection: plan.workspaceSelection },
      }, {
        target,
        plan,
        streamState,
        uiChunkEmitter,
        notifyRunStatus,
        drainSteerMessages: () => coordinator.takeSteerMessages(senderId),
        onToolActivity: persistTurnProgress,
        approvals: deps.approvals,
      });
      driver = activeDriver;

      const streamResult = await activeDriver.run();

      if (!streamResult) {
        throw new Error('Unreachable: stream loop produced no result');
      }

      if (streamResult.outcome !== 'cancelled') {
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          messageId: uiChunkEmitter.messageId,
          providerType: options.providerType,
          model: options.model,
          usage: streamResult.usage,
          source: 'chat.stream',
          metadata: {
            awaitingApproval: streamResult.outcome === 'awaiting-approval',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            ...(activeDriver.getOuterBatchCount() > 0
              ? { autonomousBatches: activeDriver.getOuterBatchCount() + 1 }
              : {}),
          },
        });

        // Attach the turn's usage + perf metrics to the assistant message so
        // the renderer can aggregate session stats (and persist them with the
        // message). Must run before finish()/abort() terminates the emitter.
        uiChunkEmitter.emitTokenUsage({
          ...(streamResult.usage ?? {}),
          ...(typeof streamResult.lastStepInputTokens === 'number'
            ? { lastStepInputTokens: streamResult.lastStepInputTokens }
            : {}),
          maxInputTokens: preparedTurn.maxInputTokens,
          maxOutputTokens: preparedTurn.maxOutputTokens,
          model: options.model,
          providerType: options.providerType,
          ...(options.providerId ? { providerId: options.providerId } : {}),
          ...(streamResult.perf ?? {}),
          contextComposition: summarizeContextComposition({
            report: preparedTurn.report,
            toolSchemaTokens: streamResult.toolSchemaTokens ?? null,
          }),
        });
      }

      const finalResponse =
        activeDriver.getAccumulatedResponse() || streamResult.response;
      const finalRunTracker = activeDriver.getRunTracker();

      finalizeRunForOutcome(finalRunTracker, streamResult, {
        text: finalResponse,
        notify: notifyRunStatus,
      });
      if (streamResult.outcome !== 'awaiting-approval') {
        uiChunkEmitter.finish();
      }
      if (options.threadId) {
        turnPersistFinalized = true;
        // Durable assistant record — partial (approval-pending) or completed.
        // Upsert converges with any late progress write on the same id.
        const settledMessage = (await uiChunkEmitter.buildPersistedMessage()) ?? {
          id: uiChunkEmitter.messageId,
          role: 'assistant' as const,
          parts: [],
        };
        await persistAssistantTurnMessage(
          deps.conversation,
          options.threadId,
          settledMessage,
          'stream',
          userTurnMessageId
        );
        // Session log: committed output + how the turn ended. An approval
        // pause is not terminal — its continuation's facts land in a later
        // slice (send/approval-resume entries are not wired yet).
        const runStatus = finalRunTracker.getRun().status;
        recordSessionEvents(options.threadId, turnFactsToEvents({
          committed: {
            runId: finalRunTracker.id,
            messageId: settledMessage.id,
            message: settledMessage as never,
            transport: 'stream',
          },
          ...(runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled'
            ? {
                terminal: {
                  runId: finalRunTracker.id,
                  status: runStatus,
                  ...(streamResult.outcome === 'handoff' ||
                    streamResult.outcome === 'budget-exhausted'
                    ? { finishReason: streamResult.outcome }
                    : {}),
                  ...(runStatus === 'failed' && streamResult.outcome === 'partial-failure'
                    ? { errorText: 'Autonomous iteration failed; partial progress saved.' }
                    : {}),
                },
              }
            : {}),
        }));
      }
      return {
        success: true,
        awaitingApproval: streamResult.outcome === 'awaiting-approval',
        ...(finalResponse ? { text: finalResponse } : {}),
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        if (coordinator.peekStream(senderId) === streamState) uiChunkEmitter.abort();
        if (options.threadId) {
          turnPersistFinalized = true;
          const abortedMessage = (await uiChunkEmitter.buildPersistedMessage()) ?? {
            id: uiChunkEmitter.messageId,
            role: 'assistant' as const,
            parts: [],
          };
          await persistAssistantTurnMessage(
            deps.conversation,
            options.threadId,
            abortedMessage,
            'stream-abort',
            userTurnMessageId
          );
          const cancelledTracker = driver?.getRunTracker() ?? sessionLogTracker;
          // A cancel while blocked records turn_cancelled while the run row
          // stays blocked (the approval remains resumable) — intentional
          // until the resume slice unifies the two.
          if (cancelledTracker) {
            recordSessionEvents(options.threadId, turnFactsToEvents({
              committed: {
                runId: cancelledTracker.id,
                messageId: abortedMessage.id,
                message: abortedMessage as never,
                transport: 'stream-abort',
              },
              terminal: {
                runId: cancelledTracker.id,
                status:
                  cancelledTracker.getRun().status === 'running' ||
                  cancelledTracker.getRun().status === 'blocked'
                    ? 'cancelled'
                    : cancelledTracker.getRun().status,
              },
            }));
          }
        }
        const activeRunTracker = driver?.getRunTracker();
        if (activeRunTracker?.getRun().status === 'running') {
          activeRunTracker.markCancelled();
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
      const activeRunTracker = driver?.getRunTracker();
      if (activeRunTracker?.getRun().status === 'running') {
        activeRunTracker.markFailed(runFailureFromError(error, message));
        notifyRunStatus();
      }
      // Session log: a failed turn is a terminal fact even when no assistant
      // row is persisted on this path. The user-facing outcome is the failure
      // regardless of which segment reached it.
      const failedTracker = activeRunTracker ?? sessionLogTracker;
      if (options.threadId && failedTracker) {
        recordSessionEvents(options.threadId, turnFactsToEvents({
          terminal: {
            runId: failedTracker.id,
            status: 'failed',
            errorText: message,
          },
        }));
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      getCompanion().clearConversationPreview();
      getCompanion().endThinking(companionThinkingKey);
      if (driver?.hasToolCalls() && !streamState.cancelled) {
        const threadLabel =
          options.threadId ? deps.getThreadTitle?.(options.threadId) : undefined;
        getCompanion().notifyReplyComplete(threadLabel);
      }
      if (
        coordinator.peekStream(senderId) === streamState &&
        !driver?.isAwaitingApproval()
      ) {
        deps.approvals.cleanupPendingSessionsForSender(senderId, uiChunkEmitter.messageId);
      }
      if (coordinator.peekStream(senderId) === streamState && options.threadId) {
        coordinator.untrackThreadStream(options.threadId, senderId);
      }
      coordinator.unregisterStream(senderId, streamState);
      release();
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
