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
export type { MessageSendResult } from './message_send';
import type { ActiveStreamState, ChatStreamTarget, RunStatusEvent } from './types';
import { createUiChunkEmitter } from './ui_stream';
import {
  getCompanion,
} from './platform';
import { resolveSkillsSystemPrompt } from './skills';
import { resolveThreadWorkspaceSelectionSnapshot } from '../workspaces/thread_workspace';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
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

    const execution = coordinator.registerExecution({
      runId: null,
      cancel: reason => {
        streamState.cancelled = true;
        streamState.abortController.abort(reason);
      },
    });

    let driver: TurnDriverHandle | null = null;

    let sessionLogTracker: import('./run_tracker').AgentRunTracker | null = null;

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

      const streamHistory = preparedTurn.history;
      const streamPrompt = preparedTurn.prompt;

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

      const harness = selectTurnHarness(plan, streamHistory);

      if (!preparedTurn.prompt.trim() && options.runConfig?.metadata?.continuation !== true) {
        throw new Error('No user prompt provided for streaming');
      }

      getCompanion().beginThinking(companionThinkingKey);

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

      const lastFacts = activeDriver.getLastFacts();

      let settledMessageRef: Awaited<
        ReturnType<typeof uiChunkEmitter.buildPersistedMessage>
      > = undefined;
      if (options.threadId) {

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

      finalizeTurn({
        tracker: finalRunTracker,
        outcome: streamResult.outcome,
        text: finalResponse,
        ...(lastFacts.usage ? { usage: lastFacts.usage } : {}),
        ...(lastFacts.pendingToolCalls && lastFacts.pendingToolCalls.length > 0
          ? { pendingToolCalls: lastFacts.pendingToolCalls }
          : {}),
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
