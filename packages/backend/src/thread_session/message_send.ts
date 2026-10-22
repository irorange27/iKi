import { createAgentRunTracker } from './run_tracker';
import { selectTurnHarness } from './turn_supply_selection';
import { createLogger } from '@iki/backend/logger';
import * as llmFactory from '../provider/llm/factory';
import { getStreamErrorMessage } from '@iki/backend/utils/errors';
import type { ToolApprovalRequest } from '@iki/backend/agent';
import {
  createApprovalRecoveryContext,
  describeApprovalRequiredTools,
  type ApprovalRecoveryContext,
  type RegisterApprovalBatch,
} from './approval_types';
import {
  assembleExecutionPlan,
  planToRunTrackerParams,
} from './execution_plan';
import {
  asChatUiMessage,
  recordSessionEvents,
  turnFactsToEvents,
} from './session_log';
import {
  createTurnDriver,
  finalizeTurn,
  finalizeTurnCancelled,
  finalizeTurnFailure,
  runFailureFromError,
} from './turn_driver';
import { NO_TOOLS_SYSTEM_PROMPT } from './constants';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import type { createChatTurnPreparer } from '../turn_prep/turn_preparer';
import {
  persistAssistantTurnMessage,
  persistUserTurnMessage,
  pickUserTurnMessage,
  pickIdLessSendInput,
} from './turn_persistence';
import { createUiChunkEmitter } from './ui_stream';
import { resolveThreadWorkspaceSelectionSnapshot } from '../workspaces/thread_workspace';
import type { ActiveStreamState, ChatStreamTarget } from './types';

const logger = createLogger({ module: 'message_send' });

export type MessageSendResult =
  | {
      success: true;
      text: string;
      runId?: string;
    }
  | {
      success: false;
      error: string;
      runId?: string;

      awaitingApproval?: boolean;
    };

export type MessageSendDeps = {
  turnPreparer: ReturnType<typeof createChatTurnPreparer>;
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
  tryAcquireThreadRun: (
    threadId?: string,
    options?: { onExecutionAbort?: () => void }
  ) => (() => void) | null;

  registerExecution?: (execution: {
    cancel: (reason: string) => void;
    runId?: string | null;
  }) => {
    setRunId: (runId: string | null) => void;
    dispose: () => void;
  };

  registerChildRunAlias?: (parentRunId: string, childRunId: string) => () => void;
  checkThreadRunRate: (threadId: string) => { allowed: boolean; retryAfterMs?: number };
  conversation: {
    createMessage: (input: unknown) => unknown;
    upsertTurnMessage: (input: unknown) => unknown;
  };

  approvals?: {
    ensurePendingApprovalSession: (
      approvalId: string,
      session: {
        target: ChatStreamTarget;
        history?: unknown[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
  };
};

export const createMessageSend = (deps: MessageSendDeps) => {
  const send = async (options: ChatTurnOptions): Promise<MessageSendResult> => {

    const cancelSource: { current: 'lease-lost' | 'user-cancel' | null } = { current: null };
    const executionAbort = new AbortController();
    const release = deps.tryAcquireThreadRun(options.threadId, {
      onExecutionAbort: () => {
        cancelSource.current = 'lease-lost';
        executionAbort.abort('thread-lease-lost');
      },
    });
    if (!release) return { success: false, error: 'A turn is already running on this thread.' };

    const execution = deps.registerExecution?.({
      runId: null,
      cancel: reason => {
        cancelSource.current = 'user-cancel';
        executionAbort.abort(reason);
      },
    });

    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    let driverHandle: ReturnType<typeof createTurnDriver> | null = null;

    try {

      const turnStartWorkspace =
        options.workspaceSelection !== undefined
          ? options.workspaceSelection
          : resolveThreadWorkspaceSelectionSnapshot(options.threadId);

      if (options.threadId) {
        const rateCheck = deps.checkThreadRunRate(options.threadId);
        if (!rateCheck.allowed) {
          return {
            success: false,
            error: `Too many requests on this thread. Retry in ${Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000)}s.`,
          };
        }
      }

      persistUserTurnMessage(deps.conversation, options);

      const preparedTurn = await deps.turnPreparer.prepareChatTurn({
        ...options,
        workspaceSelection: turnStartWorkspace,
      });
      executionAbort.signal.throwIfAborted();

      const plan = assembleExecutionPlan({
        options,
        preparedTurn,
        transport: 'send',
        workspaceSelection: turnStartWorkspace,
      });

      const activeRunTracker = createAgentRunTracker(
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
        })
      );
      runTracker = activeRunTracker;

      execution?.setRunId(activeRunTracker.id);

      const sendUserInput = pickUserTurnMessage(options);
      const sendAcceptedInput =
        sendUserInput && asChatUiMessage(sendUserInput.message)
          ? { messageId: sendUserInput.messageId, message: asChatUiMessage(sendUserInput.message)! }
          : undefined;
      const sendTaskInput = sendUserInput
        ? undefined
        : pickIdLessSendInput(options, activeRunTracker.id);
      if (options.threadId) {
        recordSessionEvents(options.threadId, turnFactsToEvents({
          ...(sendAcceptedInput
            ? { input: sendAcceptedInput }
            : sendTaskInput
              ? { input: sendTaskInput }
              : {}),
          started: { runId: activeRunTracker.id, kind: plan.kind, plan },
        }));
      }

      if (preparedTurn.enableTools) {
        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const harness = selectTurnHarness(plan, preparedTurn.history);

        const wireTarget: ChatStreamTarget = { id: -1, send: () => undefined };
        const uiChunkEmitter = createUiChunkEmitter(wireTarget, `assistant_${activeRunTracker.id}`);
        const assistantMessageId = uiChunkEmitter.messageId;

        const streamState: ActiveStreamState = {
          cancelled: false,
          stoppedByUser: false,
          abortController: executionAbort,
        };
        const registeredApprovalRequests: ToolApprovalRequest[] = [];
        const driver = createTurnDriver(
          {
            harness,
            runTracker: activeRunTracker,
            approvalContext: createApprovalRecoveryContext({
              plan,
              sessionId: assistantMessageId,
              runId: activeRunTracker.id,
            }),
            streamHistory: preparedTurn.history,
            streamPrompt: preparedTurn.prompt,
            workspaceSelectionBox: { selection: plan.workspaceSelection },
          },
          {
            target: wireTarget,
            plan,
            streamState,
            uiChunkEmitter,
            notifyRunStatus: () => undefined,
            drainSteerMessages: () => [],
            conversationPreview: false,
            onRunIdChanged: runId => execution?.setRunId(runId),
            registerChildRunAlias: deps.registerChildRunAlias,
            approvals: {
              ensurePendingApprovalSession:
                deps.approvals?.ensurePendingApprovalSession ?? (() => undefined),
              registerApprovalBatch: (requests, session) => {
                registeredApprovalRequests.push(...requests);
                deps.approvals?.registerApprovalBatch(requests, session);
              },
            },
          }
        );

        driverHandle = driver;
        const result = await driver.run();
        if (!result) throw new Error('Unreachable: send driver produced no result');

        const finalTracker = driver.getRunTracker();

        if (result.outcome === 'cancelled') {

          const leaseLost = cancelSource.current === 'lease-lost';
          const message = leaseLost
            ? 'Thread run lease was lost; the send was interrupted.'
            : 'Run cancelled.';

          if (leaseLost) {
            finalizeTurnFailure({
              tracker: finalTracker,
              failure: {
                status: 'failed',
                errorText: message,

                code: 'THREAD_LEASE_LOST',
                retryable: true,
              },
              ...(options.threadId ? { threadId: options.threadId } : {}),
              transport: 'send',
              skipRow: finalTracker.getRun().status !== 'running',
              loudGuard: true,
            });
          } else {
            finalizeTurnCancelled({
              tracker: finalTracker,
              ...(options.threadId ? { threadId: options.threadId } : {}),
              transport: 'send',
              skipRow: finalTracker.getRun().status !== 'running',
              loudGuard: true,
            });
          }
          return {
            success: false,
            error: message,
            ...(options.runConfig?.kind ? { runId: finalTracker.id } : {}),
          };
        }

        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: result.usage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            approvalRequestCount: registeredApprovalRequests.length,
          },
        });

        const finalResponse = driver.getAccumulatedResponse() || result.response || '';

        if (result.outcome === 'awaiting-approval') {

          const approvalError = describeApprovalRequiredTools(registeredApprovalRequests);
          if (!deps.approvals) {
            logger.event({
              level: 'warn',
              event: 'chat.send.approval_required',
              outcome: 'denied',
              message: approvalError,
              data: {
                thread_id: options.threadId || null,
                tool_names: registeredApprovalRequests
                  .map(request => request.toolCall?.toolName)
                  .filter(
                    (toolName): toolName is string =>
                      typeof toolName === 'string' && toolName.trim().length > 0
                  ),
              },
            });
          }

          const persisted = await uiChunkEmitter.buildPersistedMessage();
          if (options.threadId && persisted) {
            await persistAssistantTurnMessage(
              deps.conversation,
              options.threadId,
              persisted,
              'send',
            );
          }

          finalizeTurn({
            tracker: finalTracker,
            outcome: result.outcome,
            text: finalResponse,
            ...(options.threadId ? { threadId: options.threadId } : {}),
            transport: 'send',
            ...(persisted
              ? { committed: { messageId: persisted.id, message: persisted as never } }
              : {}),
          });
          return {
            success: false,
            error: approvalError,
            awaitingApproval: Boolean(deps.approvals),
            ...(options.runConfig?.kind ? { runId: finalTracker.id } : {}),
          };
        }

        uiChunkEmitter.finish();

        let settledMessage: Awaited<ReturnType<typeof uiChunkEmitter.buildPersistedMessage>> =
          undefined;
        if (options.threadId) {

          const persisted = await uiChunkEmitter.buildPersistedMessage();
          settledMessage = persisted ?? {
            id: assistantMessageId,
            role: 'assistant' as const,
            parts: [{ type: 'text', text: finalResponse, state: 'done' }],
          };
          await persistAssistantTurnMessage(
            deps.conversation,
            options.threadId,
            settledMessage,
            'send',
          );
        }
        finalizeTurn({
          tracker: finalTracker,
          outcome: result.outcome,
          text: finalResponse,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(options.threadId ? { threadId: options.threadId } : {}),
          transport: 'send',
          ...(settledMessage
            ? { committed: { messageId: settledMessage.id, message: settledMessage as never } }
            : {}),
        });
        return {
          success: true,
          text: finalResponse,

          ...(options.runConfig?.kind ? { runId: finalTracker.id } : {}),
        };
      }

      const llmResult = await llmFactory.generateChatWithModelMessages({
        providerType: options.providerType,
        providerId: options.providerId,
        modelId: options.model,
        messages: preparedTurn.finalMessages,
        extraSystemPrompt: NO_TOOLS_SYSTEM_PROMPT,
        ...(options.threadId ? { threadId: options.threadId } : {}),
        ...(typeof preparedTurn.maxOutputTokens === 'number'
          ? { maxOutputTokens: preparedTurn.maxOutputTokens }
          : {}),
        abortSignal: executionAbort.signal,
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
      if (options.threadId && llmResult.text.trim()) {

        const settledMessage = {
          id: `assistant_${activeRunTracker.id}`,
          role: 'assistant' as const,
          parts: [{ type: 'text', text: llmResult.text, state: 'done' }],
        };
        await persistAssistantTurnMessage(
          deps.conversation,
          options.threadId,
          settledMessage,
          'send',
        );

        finalizeTurn({
          tracker: activeRunTracker,
          outcome: 'completed',
          text: llmResult.text,
          ...(llmResult.usage ? { usage: llmResult.usage } : {}),
          threadId: options.threadId,
          transport: 'send',
          committed: { messageId: settledMessage.id, message: settledMessage as never },
        });
      } else {
        finalizeTurn({
          tracker: activeRunTracker,
          outcome: 'completed',
          text: llmResult.text,
          ...(llmResult.usage ? { usage: llmResult.usage } : {}),
          ...(options.threadId ? { threadId: options.threadId } : {}),
          transport: 'send',
        });
      }
      return {
        success: true,
        text: llmResult.text,
        ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
      };
    } catch (error: unknown) {

      const cancelSourceHit = cancelSource.current;
      if (cancelSourceHit) {
        const leaseLost = cancelSourceHit === 'lease-lost';
        const message = leaseLost
          ? 'Thread run lease was lost; the send was interrupted.'
          : 'Run cancelled.';
        if (leaseLost) {

          if (runTracker) {
            finalizeTurnFailure({
              tracker: runTracker,
              failure: {
                status: 'failed',
                errorText: message,

                code: 'THREAD_LEASE_LOST',
                retryable: true,
              },
              ...(options.threadId ? { threadId: options.threadId } : {}),
              transport: 'send',
              skipRow: runTracker.getRun().status !== 'running',
              loudGuard: true,
            });
          }
        } else {
          const cancelledTracker = driverHandle?.getRunTracker() ?? runTracker;
          if (cancelledTracker) {
            finalizeTurnCancelled({
              tracker: cancelledTracker,
              ...(options.threadId ? { threadId: options.threadId } : {}),
              transport: 'send',
              skipRow: cancelledTracker.getRun().status !== 'running',
              loudGuard: true,
            });
          }
        }
        return {
          success: false,
          error: message,
          ...(options.runConfig?.kind && runTracker ? { runId: runTracker.id } : {}),
        };
      }
      const message = getStreamErrorMessage(error);
      const failingTracker = driverHandle?.getRunTracker() ?? runTracker;
      if (failingTracker) {
        const retry = runFailureFromError(error, message);
        finalizeTurnFailure({
          tracker: failingTracker,
          failure: {
            status: 'failed',
            errorText: message,
            ...(retry.code ? { code: retry.code } : {}),
            ...(typeof retry.retryable === 'boolean' ? { retryable: retry.retryable } : {}),
          },
          ...(options.threadId ? { threadId: options.threadId } : {}),
          transport: 'send',
          skipRow: failingTracker.getRun().status !== 'running',
          loudGuard: true,
        });
      }
      return {
        success: false,
        error: message,
        ...(options.runConfig?.kind && failingTracker ? { runId: failingTracker.id } : {}),
      };
    } finally {
      execution?.dispose();
      release();
    }
  };

  return { send };
};

export type MessageSend = ReturnType<typeof createMessageSend>;
