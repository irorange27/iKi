import type { ModelMessage } from '@iki/backend/message/model_history';
import { cloneModelMessages, type TurnDriverHarness } from '../agent/harness';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import { planToHarnessConfig } from './execution_plan';
import { createPrefixedId } from '../utils/id';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { piDomainResumeHistory, PiSupplyRefusedError } from './turn_supply_selection';
import { reidentifyPlan } from './approval_types';
import { createAgentRunTracker, rehydrateAgentRunTracker } from './run_tracker';
import { planToRunTrackerParams } from './execution_plan';
import { recordSessionEvents, turnFactsToEvents } from './session_log';
import { createTurnDriver } from './turn_driver';
import {
  finalizeTurn,
  finalizeTurnCancelled,
  finalizeTurnFailure,
  runFailureFromError,
} from './turn_finalize';
import { executeApprovedTool, prepareToolExecution } from './tool_execution';
import { loadPersistedAssistantParts, persistAssistantTurnMessage } from './turn_persistence';
import { createUiChunkEmitter } from './ui_stream';
import type { ActiveStreamState, ChatStreamTarget } from './types';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import type { PendingApprovalSession } from './approval_session';
import type { PiResumeAdmission } from './pi_resume_admission';

export type ResumeExecutionDeps = {
  streams: {
    peek: (senderId: number) => ActiveStreamState | undefined;
    attach: (senderId: number, streamState: ActiveStreamState) => void;
    detach: (senderId: number, streamState: ActiveStreamState) => void;
    registerExecution?: (execution: {
      cancel: (reason: string) => void;
      runId?: string | null;
    }) => { setRunId: (runId: string | null) => void; dispose: () => void };
    registerChildRunAlias: (parentRunId: string, childRunId: string) => () => void;
  };
  conversation: { upsertTurnMessage: (input: unknown) => unknown };
  usage: {
    recordUsageEvent: (params: {
      threadId?: string;
      messageId?: string;
      providerType: string;
      model: string;
      usage?: Record<string, unknown>;
      source?: string;
      metadata?: Record<string, unknown>;
    }) => void;
  };
  ensurePendingApprovalSession: (
    approvalId: string,
    session: {
      target: ChatStreamTarget;
      history?: ModelMessage[];
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => unknown;
  registerApprovalBatch: RegisterApprovalBatch;
  clearApprovalTimeouts: (session: PendingApprovalSession) => void;
  cleanupPendingSessionsForSender: (senderId: number, sessionId?: string) => void;
  forgetSession: (session: PendingApprovalSession) => void;
};

export type ResumeExecutionParams = {
  session: PendingApprovalSession;
  approvalId: string;
  piResumeAdmission: PiResumeAdmission | undefined;
  executionAbort?: { current: (() => void) | null; lost: boolean };
};

export type ResumeExecutionResult =
  | { success: true; awaitingApproval?: boolean; waitingForApprovals?: string[] }
  | { success: false; error: string };

export const executeApprovalResume = async (
  params: ResumeExecutionParams,
  deps: ResumeExecutionDeps
): Promise<ResumeExecutionResult> => {
  const { session, approvalId, piResumeAdmission, executionAbort } = params;
    const resumeMessageId = session.recoveryContext?.sessionId ?? createPrefixedId('assistant');
    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    if (executionAbort) {

      executionAbort.current = () => {
        streamState.cancelled = true;
        streamState.abortController.abort('thread-lease-lost');
      };
      if (executionAbort.lost) executionAbort.current();
    }
    const uiChunkEmitter = createUiChunkEmitter(session.target, resumeMessageId);
    const baseApprovalContext = session.recoveryContext
      ? {
          ...session.recoveryContext,
          sessionId: resumeMessageId,
          assistantMessageId: resumeMessageId,
        }
      : undefined;
    const resumePlan = baseApprovalContext
      ? reidentifyPlan(baseApprovalContext.plan, {
          kind: 'approval-resume',
          parentRunId: baseApprovalContext.runId,
          transport: 'approval-resume',
        })
      : undefined;
    const resumeRunTracker = resumePlan
      ? createAgentRunTracker(
          planToRunTrackerParams(resumePlan, {
            input: {
              messages: session.history ?? [],
            },
            working: {
              accumulatedText: '',
              pendingApprovalIds: Array.from(session.pendingApprovalIds).filter(
                id => !session.collectedApprovalResponses.has(id)
              ),
              lastStepIndex: 0,
            },
            metadataExtras: {
              sourceSessionId: session.sessionId ?? session.recoveryContext?.sessionId ?? null,
              sourceRunId: session.recoveryContext?.runId ?? null,
              answeredApprovalIds: Array.from(session.collectedApprovalResponses.keys()),
              assistantMessageId: uiChunkEmitter.messageId,
            },
          })
        )
      : null;
    if (resumePlan?.threadId && resumeRunTracker) {

      const parentStatus = baseApprovalContext?.runId
        ? rehydrateAgentRunTracker(baseApprovalContext.runId)?.getRun().status
        : undefined;
      const parentStillResumable =
        parentStatus === 'running' || parentStatus === 'blocked' || parentStatus === 'queued';

      try {
        recordSessionEvents(
          resumePlan.threadId,
          turnFactsToEvents({
            ...(baseApprovalContext?.runId && parentStillResumable
              ? {
                  terminal: {
                    runId: baseApprovalContext.runId,
                    status: 'completed' as const,
                    finishReason: 'approval-resumed',
                  },
                }
              : {}),
            started: { runId: resumeRunTracker.id, kind: resumePlan.kind, plan: resumePlan },
          })
        );
      } catch (error) {
        session.collectedApprovalResponses.delete(approvalId);

        finalizeTurnFailure({
          tracker: resumeRunTracker,
          failure: {
            status: 'failed',
            errorText: getErrorMessage(error),
            retryable: true,
          },
          threadId: resumePlan.threadId,
          transport: 'approval-resume',
          loudGuard: true,
        });
        throw error;
      }
    }

    deps.clearApprovalTimeouts(session);
    deps.forgetSession(session);

    const resumedSenderId = session.target.id;
    const existingStream = deps.streams.peek(resumedSenderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('resume-after-tool-approval');
    }

    if (resumeRunTracker && baseApprovalContext?.runId) {
      rehydrateAgentRunTracker(baseApprovalContext.runId)?.markResumed({
        childRunId: resumeRunTracker.id,
      });
    }
    const nextApprovalContext = baseApprovalContext
      ? {
          ...baseApprovalContext,
          ...(resumePlan ? { plan: resumePlan } : {}),
          ...(resumeRunTracker ? { runId: resumeRunTracker.id } : {}),
        }
      : undefined;
    streamState.runId = resumeRunTracker?.id;
    deps.streams.attach(resumedSenderId, streamState);

    const execution = deps.streams.registerExecution?.({
      runId: resumeRunTracker?.id ?? null,
      cancel: reason => {
        streamState.cancelled = true;
        streamState.abortController.abort(reason);
      },
    });
    let isAwaitingApproval = false;

    let driverHandle: ReturnType<typeof createTurnDriver> | null = null;

    try {
      const ctx = nextApprovalContext ?? session.recoveryContext;
      if (!ctx || !resumeRunTracker) {
        throw new Error("Approval resume requires the paused turn's recovery context");
      }

      if (!piResumeAdmission) {
        throw new PiSupplyRefusedError(
          'the paused turn no longer matches an admissible provider plan (its provider row may have been removed or disabled)',
          'config',
          {
            providerType: ctx.plan.providerType,
            providerId: ctx.plan.providerId ?? null,
            model: ctx.plan.model,
          }
        );
      }
      const approvalHarness: TurnDriverHarness = new PiToolTurnHarness(
        planToHarnessConfig(ctx.plan),
        {
          resume: {
            commands: piResumeAdmission.commands,
            owner: {
              prepare: address => prepareToolExecution(address),
              executeApproved: (address, port) =>
                executeApprovedTool(address, {
                  signal: port.signal ?? new AbortController().signal,
                  execute: async (toolName, args) =>
                    (await port.execute(toolName, args)) as unknown,
                }),
            },
          },
        }
      );

      const streamHistory = piDomainResumeHistory(cloneModelMessages(session.history ?? []));

      const persistResumeProgress = () => {
        const threadId = baseApprovalContext?.plan.threadId;
        if (!threadId) return;
        void uiChunkEmitter
          .buildPersistedMessage(loadPersistedAssistantParts(uiChunkEmitter.messageId))
          .then(persisted =>
            persisted
              ? persistAssistantTurnMessage(
                  deps.conversation,
                  threadId,
                  persisted,
                  'stream-progress'
                )
              : undefined
          );
      };

      const driver = createTurnDriver(
        {
          harness: approvalHarness,
          runTracker: resumeRunTracker,
          approvalContext: nextApprovalContext,
          streamHistory,
          streamPrompt: '',
          ...(ctx.plan.workspaceSelection !== undefined
            ? { workspaceSelectionBox: { selection: ctx.plan.workspaceSelection } }
            : {}),
        },
        {
          target: session.target,
          plan: ctx.plan,
          streamState,
          uiChunkEmitter,
          notifyRunStatus: () => undefined,
          drainSteerMessages: () => [],
          conversationPreview: false,
          onToolActivity: persistResumeProgress,

          onRunIdChanged: runId => execution?.setRunId(runId),
          registerChildRunAlias: deps.streams.registerChildRunAlias,
          approvals: {
            ensurePendingApprovalSession: deps.ensurePendingApprovalSession,
            registerApprovalBatch: deps.registerApprovalBatch,
          },
        }
      );

      driverHandle = driver;
      const driverResult = await driver.run();
      if (!driverResult) {
        throw new Error('Unreachable: approval resume produced no result');
      }
      const streamResult = driverResult;

      isAwaitingApproval = streamResult.outcome === 'awaiting-approval';
      if (streamResult.outcome === 'cancelled') {
        uiChunkEmitter.abort();
      } else if (!isAwaitingApproval) {
        uiChunkEmitter.finish();
      }

      if (streamResult.outcome !== 'cancelled' && nextApprovalContext) {
        deps.usage.recordUsageEvent({
          threadId: nextApprovalContext.plan.threadId,
          messageId: uiChunkEmitter.messageId,
          providerType: nextApprovalContext.plan.providerType,
          model: nextApprovalContext.plan.model,
          usage: streamResult.usage,
          source: 'chat.approval-stream',
          metadata: {
            sessionId: nextApprovalContext.sessionId,
            awaitingApproval: isAwaitingApproval,
          },
        });
      }

      let persistedContinuation:
        | Awaited<ReturnType<typeof uiChunkEmitter.buildPersistedMessage>>
        | undefined;
      if (baseApprovalContext?.plan.threadId) {

        persistedContinuation = await uiChunkEmitter.buildPersistedMessage(
          loadPersistedAssistantParts(uiChunkEmitter.messageId)
        );
        if (persistedContinuation) {
          await persistAssistantTurnMessage(
            deps.conversation,
            baseApprovalContext.plan.threadId,
            persistedContinuation,
            'approval-resume'
          );
        }
      }
      const continuationText = driver.getAccumulatedResponse() || streamResult.response;
      finalizeTurn({
        tracker: driver.getRunTracker(),
        outcome: streamResult.outcome,
        text: continuationText,
        ...(streamResult.usage ? { usage: streamResult.usage } : {}),
        ...(baseApprovalContext?.plan.threadId
          ? { threadId: baseApprovalContext.plan.threadId }
          : {}),
        transport: 'approval-resume',
        ...(persistedContinuation
          ? {
              committed: {
                messageId: persistedContinuation.id,
                message: persistedContinuation as never,
              },
            }
          : {}),
      });
      return {
        success: true,
        awaitingApproval: isAwaitingApproval,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const failingTracker = driverHandle?.getRunTracker() ?? resumeRunTracker;
      const teardown = failingTracker
        ? {
            tracker: failingTracker,
            ...(failingTracker.getRun().threadId
              ? { threadId: failingTracker.getRun().threadId as string }
              : {}),
            transport: 'approval-resume',
            skipRow: failingTracker.getRun().status !== 'running',
            loudGuard: true,
          }
        : null;

      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (teardown) finalizeTurnCancelled(teardown);
        return { success: true };
      }
      if (teardown) {
        const retry = runFailureFromError(error, message);
        finalizeTurnFailure({
          ...teardown,
          failure: {
            status: 'failed',
            errorText: message,
            ...(retry.code ? { code: retry.code } : {}),
            ...(typeof retry.retryable === 'boolean' ? { retryable: retry.retryable } : {}),
          },
        });
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (deps.streams.peek(resumedSenderId) === streamState && !isAwaitingApproval) {
        deps.cleanupPendingSessionsForSender(resumedSenderId, resumeMessageId);
      }
      deps.streams.detach(resumedSenderId, streamState);
      execution?.dispose();
    }
};
