import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { getStreamErrorMessage } from '@iki/backend/utils/errors';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import { createApprovalRecoveryContext } from './approval_types';
import {
  assembleExecutionPlan,
  planToRunTrackerParams,
} from './execution_plan';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createAgentRunTracker } from './run_tracker';
import { summarizeContextComposition } from '../turn_prep/context_helpers';
import { selectTurnHarness } from './turn_supply_selection';
import { createChatStreamingModels } from './models';
import { createChatTurnPreparer, type ChatTurnOptions } from '../turn_prep/turn_preparer';
import { createMessageSend } from './message_send';
import { buildHandoffResumeContext } from './handoff_resume';
export type { MessageSendResult } from './message_send';
import type { ActiveStreamState, ChatStreamTarget, RunStatusEvent } from './types';
import { createUiChunkEmitter } from './ui_stream';
import {
  getCompanion,
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
  recordFailureTerminalEvent,
  recordSessionEvents,
  turnFactsToEvents,
} from './session_log';
import type { ThreadStreamCoordinator } from './thread_stream_coordinator';
import {
  createTurnDriver,
  finalizeTurn,
  finalizeTurnCancelled,
  finalizeTurnFailure,
  runFailureFromError,
  type TurnDriverHandle,
} from './turn_driver';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export const createChatStreaming = (deps: {
  streamCoordinator: ThreadStreamCoordinator;
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
        history?: import('../message/model_history').ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
    cleanupPendingSessionsForSender: (senderId: number, sessionId?: string) => void;
  };
}) => {
  const turnPreparer = createChatTurnPreparer({
    resolveSkillsSystemPrompt,
    getRuntimeConfig: () => {
      try {
        const config = getAppConfig();
        return {
          autoApproveToolRequests: config?.general?.autoApproveToolRequests === true,
          contextBudget: config?.context ?? null,
        };
      } catch {
        return { autoApproveToolRequests: false, contextBudget: null };
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
    registerExecution: coordinator.registerExecution,
    registerChildRunAlias: coordinator.registerChildRunAlias,
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
        return {
          success: false,
          error: `Too many requests on this thread. Retry in ${delaySec}s.`,
        };
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
    // The stream registry answers "who is subscribed"; this registration
    // answers "who executes run X" — the question a cancel asks. A stream is
    // cancelled by run id even when the sender has already moved on.
    const execution = coordinator.registerExecution({
      runId: null,
      cancel: reason => {
        streamState.cancelled = true;
        streamState.abortController.abort(reason);
      },
    });

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
      // synchronous and ahead of every await (preparation, workspace resolution),
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

      const approvalPolicy = parseApprovalPolicy(options.approvalPolicy);
      if (preparedTurn.enableTools && !approvalPolicy && !preparedTurn.requireApproval) {
        // A tool turn with no explicit policy. This used to ALSO auto-run
        // workspace writes — exactly how a frontend wiring gap silently became
        // "approvals never asked" once. The resolver no longer clears a tool's
        // own declared approval (#166), so writes that ask for approval still
        // get it; the warning stays because the missing policy is still a
        // wiring gap worth surfacing.
        chatStreamingLogger.event({
          level: 'warn',
          event: 'chat.stream.approval_policy',
          outcome: 'degraded',
          entity: { thread_id: options.threadId || null },
          message:
            'Tool-enabled turn started without an explicit approval policy; legacy defaults may auto-run workspace writes.',
          data: {
            hint: 'The composer should send approvalPolicy (ChatInput approvalPolicy prop).',
          },
        });
      }

      let streamHistory = preparedTurn.history;
      let streamPrompt = preparedTurn.prompt;

      if (options.runConfig?.kind === 'handoff-resume' && options.runConfig?.parentRunId) {
        // The parent's transcript comes from the session-log replay (ADR 010
        // §3), not from the run row's removed `working.modelMessages` copy.
        // The parent row is read only for its threadId — the replay is keyed
        // by conversation, and a row without one has no log to rebuild from.
        const parentRun = agentRunDb.getAgentRun(options.runConfig.parentRunId);
        const handoffResume = await buildHandoffResumeContext({
          threadId: parentRun?.threadId ?? options.threadId,
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
            accumulatedText: '',
            pendingApprovalIds: [],
            lastStepIndex: 0,
          },
          metadataExtras: { assistantMessageId: uiChunkEmitter.messageId },
        })
      );
      streamState.runId = runTracker.id;
      execution.setRunId(runTracker.id);
      sessionLogTracker = runTracker;

      // Session log: the accepted input and the turn's frozen plan are
      // business facts, recorded before execution begins. A write failure
      // fails the turn before it runs (ADR 008 F1) — an unrecorded turn must
      // not execute.
      const userTurnInput = pickUserTurnMessage(options);
      const acceptedInput =
        userTurnInput && asChatUiMessage(userTurnInput.message)
          ? { messageId: userTurnInput.messageId, message: asChatUiMessage(userTurnInput.message)! }
          : undefined;
      recordSessionEvents(
        options.threadId ?? '',
        turnFactsToEvents({
          ...(acceptedInput ? { input: acceptedInput } : {}),
          started: { runId: runTracker.id, kind: plan.kind, plan },
        })
      );

      const approvalContext = preparedTurn.enableTools
        ? createApprovalRecoveryContext({
            plan,
            sessionId: uiChunkEmitter.messageId,
            runId: runTracker.id,
          })
        : undefined;

      // Supply selection (switch items 2c/3a/3b/3c): one selector decides.
      // Pi serves text-only turns and tool turns in every mode (autonomous
      // chains included) under ANY approval policy (pause + five-state
      // resume). A shape the selector cannot serve is refused, never
      // re-routed to another executor.
      const harness = selectTurnHarness(plan, streamHistory);

      // An effect-aware continuation (#143) re-enters with the dead chain's
      // journaled exchange pairs as the history tail and NO user prompt —
      // the model continues from what already happened. The guard stands
      // down only for that shape; ordinary empty sends still refuse.
      if (!preparedTurn.prompt.trim() && options.runConfig?.metadata?.continuation !== true) {
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
      const activeDriver = createTurnDriver(
        {
          harness,
          runTracker,
          approvalContext,
          streamHistory,
          streamPrompt,
          workspaceSelectionBox: { selection: plan.workspaceSelection },
        },
        {
          target,
          plan,
          streamState,
          uiChunkEmitter,
          notifyRunStatus,
          drainSteerMessages: () => coordinator.takeSteerMessages(senderId),
          onToolActivity: persistTurnProgress,
          onRunIdChanged: runId => execution.setRunId(runId),
          registerChildRunAlias: coordinator.registerChildRunAlias,
          approvals: deps.approvals,
        }
      );
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
            ...(activeDriver.getBatchCount() > 0
              ? { autonomousBatches: activeDriver.getBatchCount() + 1 }
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

      const finalResponse = activeDriver.getAccumulatedResponse() || streamResult.response;
      const finalRunTracker = activeDriver.getRunTracker();
      // The facts of the batch that ended the turn (a handoff chain finalized
      // its parent segments itself, so the driver's return value describes
      // only the last chained segment).
      const lastFacts = activeDriver.getLastFacts();

      // Event-first (ADR 008 F1): the turn's facts reach the session log
      // BEFORE the run row finalizes — a write failure fails the turn through
      // the catch below while the row is still non-terminal, never leaving a
      // terminal row whose outcome was never recorded. The record also
      // precedes finish(): a terminated emitter drops error chunks, so the
      // failure must be caught while the failure channel is still open.
      let settledMessageRef: Awaited<
        ReturnType<typeof uiChunkEmitter.buildPersistedMessage>
      > = undefined;
      if (options.threadId) {
        // Durable assistant record — partial (approval-pending) or completed.
        // Upsert converges with any late progress write on the same id.
        // Parts close first (without terminating the channel) so the built
        // message carries their final state.
        uiChunkEmitter.settleParts();
        const settledMessage = (await uiChunkEmitter.buildPersistedMessage()) ?? {
          id: uiChunkEmitter.messageId,
          role: 'assistant' as const,
          parts: [],
        };
        settledMessageRef = settledMessage;
        turnPersistFinalized = true;
        await persistAssistantTurnMessage(
          deps.conversation,
          options.threadId,
          settledMessage,
          'stream',
          userTurnMessageId
        );
      }
      if (streamResult.outcome !== 'awaiting-approval') {
        uiChunkEmitter.finish();
      }
      // Session log + run row: ONE outcome row writes both projections — the
      // committed output rides the same record as its terminal fact, and the
      // row is finalized only after the facts landed (ADR 008 F1).
      finalizeTurn({
        tracker: finalRunTracker,
        outcome: streamResult.outcome,
        text: finalResponse,
        ...(lastFacts.usage ? { usage: lastFacts.usage } : {}),
        ...(lastFacts.pendingToolCalls && lastFacts.pendingToolCalls.length > 0
          ? { pendingToolCalls: lastFacts.pendingToolCalls }
          : {}),
        ...(streamResult.outcome === 'handoff' ? { handoff: streamResult.handoff } : {}),
        ...(options.threadId ? { threadId: options.threadId } : {}),
        transport: 'stream',
        ...(settledMessageRef
          ? { committed: { messageId: settledMessageRef.id, message: settledMessageRef as never } }
          : {}),
        notify: notifyRunStatus,
      });
      return {
        success: true,
        awaitingApproval: streamResult.outcome === 'awaiting-approval',
        ...(finalResponse ? { text: finalResponse } : {}),
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        if (coordinator.peekStream(senderId) === streamState) uiChunkEmitter.abort();
        const cancelledTracker = driver?.getRunTracker() ?? sessionLogTracker;
        let abortedMessage:
          | { id: string; role: 'assistant'; parts: [] }
          | Awaited<ReturnType<typeof uiChunkEmitter.buildPersistedMessage>>
          | undefined;
        if (options.threadId) {
          turnPersistFinalized = true;
          const persistedAbort = (await uiChunkEmitter.buildPersistedMessage()) ?? {
            id: uiChunkEmitter.messageId,
            role: 'assistant' as const,
            parts: [],
          };
          abortedMessage = persistedAbort;
          await persistAssistantTurnMessage(
            deps.conversation,
            options.threadId,
            persistedAbort,
            'stream-abort',
            userTurnMessageId
          );
        }
        if (cancelledTracker) {
          // A cancel while blocked records turn_cancelled while the run row
          // stays blocked (the approval remains resumable): the cancellation
          // is the event, the row is the resumable handle. Failure-path
          // terminal, loud-guarded — the record must not mask the
          // cancellation being reported (ADR 008 F1).
          const rowStatus = cancelledTracker.getRun().status;
          finalizeTurnCancelled({
            tracker: cancelledTracker,
            ...(abortedMessage
              ? { committed: { messageId: abortedMessage.id, message: abortedMessage as never } }
              : {}),
            ...(options.threadId ? { threadId: options.threadId } : {}),
            transport: 'stream-abort',
            ...(rowStatus !== 'running' ? { keepRowStatus: rowStatus } : {}),
            notify: notifyRunStatus,
          });
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
      // The pre-execution window (run row created, driver not yet built) has
      // no driver tracker — the stream's own tracker carries the failure.
      // One call writes both projections, loud-guarded: a failed turn is a
      // terminal fact even when no assistant row is persisted on this path,
      // and losing the record must not mask the reported failure
      // (ADR 008 F1).
      const failedTracker = driver?.getRunTracker() ?? sessionLogTracker;
      if (failedTracker) {
        const retry = runFailureFromError(error, message);
        finalizeTurnFailure({
          tracker: failedTracker,
          failure: {
            status: 'failed',
            errorText: message,
            ...(retry.code ? { code: retry.code } : {}),
            ...(typeof retry.retryable === 'boolean' ? { retryable: retry.retryable } : {}),
          },
          // The text the commit gate WITHHELD: never published, never in
          // history, but it is what the turn produced before failing, so the
          // row keeps it distinguishable from a turn that produced nothing.
          ...(typeof retry.text === 'string' && retry.text.length > 0
            ? { text: retry.text }
            : {}),
          ...(options.threadId ? { threadId: options.threadId } : {}),
          transport: 'stream',
          skipRow: failedTracker.getRun().status !== 'running',
          loudGuard: true,
          notify: notifyRunStatus,
        });
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      getCompanion().clearConversationPreview();
      getCompanion().endThinking(companionThinkingKey);
      if (driver?.hasToolCalls() && !streamState.cancelled) {
        const threadLabel = options.threadId ? deps.getThreadTitle?.(options.threadId) : undefined;
        getCompanion().notifyReplyComplete(threadLabel);
      }
      if (coordinator.peekStream(senderId) === streamState && !driver?.isAwaitingApproval()) {
        deps.approvals.cleanupPendingSessionsForSender(senderId, uiChunkEmitter.messageId);
      }
      if (coordinator.peekStream(senderId) === streamState && options.threadId) {
        coordinator.untrackThreadStream(options.threadId, senderId);
      }
      coordinator.unregisterStream(senderId, streamState);
      execution.dispose();
      release();
    }
  };

  return {
    getModels: streamingModels.getModels,
    isProviderConfigured: streamingModels.isProviderConfigured,
    send,
    stream,
    stopStream: coordinator.stopStream,
    steerStream: coordinator.steerStream,
  };
};

export type ChatStreaming = ReturnType<typeof createChatStreaming>;
