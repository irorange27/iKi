import { createAgentRunTracker } from './run_tracker';
import { startTurnHarness } from '../agent/harness';
import { createLogger } from '@iki/backend/logger';
import * as llmFactory from '../provider/llm/factory';
import { runWithToolRuntimeContext } from '../utils/runtime_context';
import { getStreamErrorMessage } from '@iki/backend/utils/errors';
import {
  createApprovalRecoveryContext,
  describeApprovalRequiredTools,
  type ApprovalRecoveryContext,
  type RegisterApprovalBatch,
} from './approval_types';
import {
  assembleExecutionPlan,
  planToHarnessConfig,
  planToRunTrackerParams,
} from './execution_plan';
import { NO_TOOLS_SYSTEM_PROMPT } from './constants';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import type { createChatTurnPreparer } from '../turn_prep/turn_preparer';
import { writeThreadTodoPlan } from '../db/thread_todos';
import { persistAssistantTurnMessage, persistUserTurnMessage } from './turn_persistence';
import { createUiChunkEmitter } from './ui_stream';
import { resolveThreadWorkspaceSelectionSnapshot } from '../workspaces/thread_workspace';
import type { ChatStreamEvent, ChatStreamTarget } from './types';

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
      /** The turn paused on tool approvals that are durably registered. */
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
  checkThreadRunRate: (threadId: string) => { allowed: boolean; retryAfterMs?: number };
  conversation: {
    createMessage: (input: unknown) => unknown;
    upsertTurnMessage: (input: unknown) => unknown;
  };
  /** Durable approval registration (service wiring). Without it, an
   *  approval-required send stays the non-interactive error path. */
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
    // The execution abort controller exists before admission: the lease-loss
    // hook registered below must have a live target from the first await on.
    const executionAbort = new AbortController();
    const release = deps.tryAcquireThreadRun(options.threadId, {
      onExecutionAbort: () => executionAbort.abort('thread-lease-lost'),
    });
    if (!release) return { success: false, error: 'A turn is already running on this thread.' };
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    try {
      if (options.threadId) {
        const rateCheck = deps.checkThreadRunRate(options.threadId);
        if (!rateCheck.allowed) {
          return {
            success: false,
            error: `Too many requests on this thread. Retry in ${Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000)}s.`,
          };
        }
      }

      // After admission: a rejected request must not leave a durable row.
      persistUserTurnMessage(deps.conversation, options);

      const preparedTurn = await deps.turnPreparer.prepareChatTurn(options);
      executionAbort.signal.throwIfAborted();

      // The plan is the single definition of this execution (same assembly
      // the streaming path uses); the workspace binding is resolved at the
      // same post-prepare point the tool path used before.
      const plan = assembleExecutionPlan({
        options,
        preparedTurn,
        transport: 'send',
        workspaceSelection: resolveThreadWorkspaceSelectionSnapshot(options.threadId),
      });

      const activeRunTracker = createAgentRunTracker(
        planToRunTrackerParams(plan, {
          input: {
            ...(preparedTurn.prompt.trim() ? { prompt: preparedTurn.prompt } : {}),
            messages: preparedTurn.finalMessages,
          },
          working: {
            modelMessages: preparedTurn.history,
            accumulatedText: '',
            pendingApprovalIds: [],
            lastStepIndex: 0,
          },
        })
      );
      runTracker = activeRunTracker;

      if (preparedTurn.enableTools) {
        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const harness = startTurnHarness(planToHarnessConfig(plan));

        // ponytail: clear stale todo plan from previous turn
        writeThreadTodoPlan({ threadId: options.threadId, items: [] });

        // Send runs the same durable projection as streaming: every step fact
        // is emitted into a UI chunk emitter so the persisted assistant row
        // (and the next turn's rebuilt context) keeps the full tool exchanges.
        const wireTarget: ChatStreamTarget = { id: -1, send: () => undefined };
        const uiChunkEmitter = createUiChunkEmitter(wireTarget, `assistant_${activeRunTracker.id}`);
        const assistantMessageId = uiChunkEmitter.messageId;

        const output = await runWithToolRuntimeContext(
          {
            runId: activeRunTracker.id,
            runTracker: activeRunTracker,
            threadId: options.threadId,
            conversationModel: {
              providerType: options.providerType,
              providerId: options.providerId,
              model: options.model,
            },
            workspaceSelectionBox: { selection: plan.workspaceSelection },
          },
          async () => {
            for await (const event of harness.turn({
              prompt: preparedTurn.prompt,
              history: preparedTurn.history,
              onInference: record => activeRunTracker.recordModelStep(record),
              abortSignal: executionAbort.signal,
            })) {
              if (event.event === 'step') {
                activeRunTracker.recordAgentStep(event.step);
                const step = event.step;
                if (step.type === 'message_update') {
                  if (step.kind === 'reasoning') uiChunkEmitter.emitReasoningDelta(step.text);
                  else uiChunkEmitter.emitTextDelta(step.text);
                } else if (step.type === 'tool_execution_start') {
                  const uiEvent: ChatStreamEvent = {
                    type: 'tool-call',
                    toolCallId: step.toolCallId,
                    toolName: step.toolName,
                    input: step.input,
                  };
                  uiChunkEmitter.emitToolEvent(uiEvent);
                } else if (step.type === 'tool_execution_end') {
                  const uiEvent: ChatStreamEvent =
                    step.outcome === 'success'
                      ? { type: 'tool-result', toolCallId: step.toolCallId, output: step.output }
                      : {
                          type: 'tool-error',
                          toolCallId: step.toolCallId,
                          error: step.error ?? 'Tool execution failed',
                        };
                  uiChunkEmitter.emitToolEvent(uiEvent);
                } else if (step.type === 'approval_request') {
                  for (const request of step.requests) {
                    if (!request.approvalId) continue;
                    uiChunkEmitter.emitToolEvent({
                      type: 'tool-approval-request',
                      approvalId: request.approvalId,
                      toolCallId: request.toolCallId || '',
                      ...(request.toolCall
                        ? {
                            toolCall: {
                              toolName: request.toolCall.toolName,
                              toolCallId: request.toolCallId || '',
                              args: request.toolCall.args ?? {},
                            },
                          }
                        : {}),
                    });
                  }
                }
              }
              if (event.event === 'done') return event.output;
            }
            throw new Error('Agent harness produced no output');
          }
        );

        activeRunTracker.syncModelMessages(harness.getHistory());
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: output.usage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            approvalRequestCount: output.toolApprovalRequests?.length ?? 0,
          },
        });
        if (output.toolApprovalRequests && output.toolApprovalRequests.length > 0) {
          const approvalError = describeApprovalRequiredTools(output.toolApprovalRequests);
          activeRunTracker.markBlocked({
            text: output.text,
            usage: output.usage ? { ...output.usage } : undefined,
            pendingApprovalIds: output.toolApprovalRequests.map(request => request.approvalId),
          });
          if (deps.approvals) {
            // Durable decision handle: same registration the streaming path
            // performs, so this pause is resumable through approveTool (and
            // recoverable after a restart) instead of name-only "blocked".
            const recoveryContext = createApprovalRecoveryContext({
              plan,
              sessionId: assistantMessageId,
              runId: activeRunTracker.id,
            });
            deps.approvals.registerApprovalBatch(output.toolApprovalRequests, {
              target: wireTarget,
              history: harness.getHistory() ?? preparedTurn.history,
              recoveryContext,
            });
          } else {
            logger.event({
              level: 'warn',
              event: 'chat.send.approval_required',
              outcome: 'denied',
              message: approvalError,
              data: {
                thread_id: options.threadId || null,
                tool_names: output.toolApprovalRequests
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
          return {
            success: false,
            error: approvalError,
            awaitingApproval: Boolean(deps.approvals),
            ...(options.runConfig?.kind ? { runId: activeRunTracker.id } : {}),
          };
        }
        activeRunTracker.markCompleted({
          text: output.text,
          usage: output.usage ? { ...output.usage } : undefined,
          finishReason: 'completed',
        });
        uiChunkEmitter.finish();
        if (options.threadId) {
          // Deterministic per-run id: a duplicate persist of the same turn
          // converges on one row and the message joins back to its run.
          // Retries are separate runs and legitimately separate rows.
          const persisted = await uiChunkEmitter.buildPersistedMessage();
          await persistAssistantTurnMessage(
            deps.conversation,
            options.threadId,
            persisted ?? {
              id: assistantMessageId,
              role: 'assistant',
              parts: [{ type: 'text', text: output.text, state: 'done' }],
            },
            'send',
          );
        }
        return {
          success: true,
          text: output.text,
          ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
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
      runTracker.markCompleted({
        text: llmResult.text,
        usage: llmResult.usage ? { ...llmResult.usage } : undefined,
        finishReason: 'completed',
      });
      if (options.threadId && llmResult.text.trim()) {
        // Deterministic per-run id (see the tool path above).
        await persistAssistantTurnMessage(
          deps.conversation,
          options.threadId,
          {
            id: `assistant_${activeRunTracker.id}`,
            role: 'assistant',
            parts: [{ type: 'text', text: llmResult.text, state: 'done' }],
          },
          'send',
        );
      }
      return {
        success: true,
        text: llmResult.text,
        ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
      };
    } catch (error: unknown) {
      if (executionAbort.signal.aborted && executionAbort.signal.reason === 'thread-lease-lost') {
        // The thread was taken over while this send ran: stop cleanly at the
        // barrier instead of reporting a provider error or persisting results
        // from an execution that lost its run right.
        const message = 'Thread run lease was lost; the send was interrupted.';
        if (runTracker && runTracker.getRun().status === 'running') {
          runTracker.markFailed({ message, code: 'THREAD_LEASE_LOST', retryable: true });
        }
        return {
          success: false,
          error: message,
          ...(options.runConfig?.kind && runTracker ? { runId: runTracker.id } : {}),
        };
      }
      const message = getStreamErrorMessage(error);
      if (runTracker && runTracker.getRun().status === 'running') {
        runTracker.markFailed({ message });
      }
      return {
        success: false,
        error: message,
        ...(options.runConfig?.kind && runTracker ? { runId: runTracker.id } : {}),
      };
    } finally {
      release();
    }
  };

  return { send };
};

export type MessageSend = ReturnType<typeof createMessageSend>;
