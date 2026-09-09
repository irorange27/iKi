import type { ModelMessage } from 'ai';

import { createLogger } from '@iki/backend/logger';
import { addTurnPerf, type AgentStep, type AgentTurnPerf } from '@iki/backend/agent';
import type { ConversationPreview } from '@iki/backend/types/companion';
import { traceChatTurn } from '@iki/backend/observability/langfuse';
import { runWithToolRuntimeContext } from '../utils/runtime_context';
import { rehydrateHarness, type AgentHarness } from '../agent/harness';
import type { AgentRunTracker } from '../turn_prep/run_tracker';
import { createAgentRunTracker } from '../turn_prep/run_tracker';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from '../turn_prep/approval_types';
import { createApprovalRecoveryContext } from '../turn_prep/approval_types';
import type { ChatTurnOptions, PreparedChatTurn } from '../turn_prep/turn_preparer';
import { buildFreshHandoffSystemMessage } from './handoff_resume';
import { autoCompactHistory } from './token_estimator';
import { getCompanion } from './platform';
import { writeThreadTodoPlan } from '../db/thread_todos';
import type { ActiveStreamState, ChatStreamEvent, ChatStreamTarget, UiChunkEmitter } from './types';

// Same module tag as session_loop: the outer loop is the same logical
// component, and the auto_compact event keeps its log contract.
const outerLoopLogger = createLogger({ module: 'chat_streaming' });

export type OuterLoopStreamResult = {
  awaitingApproval: boolean;
  cancelled?: boolean;
  finished?: boolean;
  partialFailure?: boolean;
  response?: string;
  usage?: import('@iki/backend/agent').AgentResult['usage'];
  /** Perf metrics accumulated across all outer batches of the turn. */
  perf?: AgentTurnPerf;
  handoff?: { summary: string; nextSteps: string; reason: string };
};

/**
 * Mutable per-stream state the outer loop drives across batches. The caller
 * builds it after turn preparation and reads the final values for finalize
 * and cleanup.
 */
export type OuterLoopState = {
  harness: AgentHarness;
  runTracker: AgentRunTracker;
  approvalContext?: ApprovalRecoveryContext;
  streamHistory: ModelMessage[];
  streamPrompt: string;
  accumulatedResponse: string;
  outerBatch: number;
  handoffChain: number;
  turnHadToolCalls: boolean;
  isAwaitingApproval: boolean;
};

export type OuterLoopDeps = {
  target: ChatStreamTarget;
  options: ChatTurnOptions;
  preparedTurn: PreparedChatTurn;
  maxIterations: number;
  autonomousMode: boolean;
  systemPrompt: string;
  streamState: ActiveStreamState;
  uiChunkEmitter: UiChunkEmitter;
  notifyRunStatus: () => void;
  drainSteerMessages: () => string[];
  approvals: {
    ensurePendingApprovalSession: (
      approvalId: string,
      session: {
        target: ChatStreamTarget;
        history?: ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
  };
};

const MAX_OUTER_AUTONOMOUS_BATCHES = 50;
const MAX_HANDOFF_CHAIN = 5;

/**
 * The outer autonomous loop (ADR 004): one harness.turn() per batch,
 * autonomous mode only, with steer restart, approval blocking, handoff
 * chaining, and batch-boundary auto-compaction. Mutates `state` in place;
 * the caller owns catch/finally and run finalization.
 */
export const runOuterLoop = async (
  state: OuterLoopState,
  deps: OuterLoopDeps,
): Promise<OuterLoopStreamResult | undefined> => {
  const { target, options, preparedTurn, streamState, uiChunkEmitter } = deps;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previewText = '';
  let lastPreviewText = '';
  let streamResult: OuterLoopStreamResult | undefined;
  let accumulatedPerf: AgentTurnPerf | undefined;

  const sendConversationPreview = (kind: ConversationPreview['kind'], text: string, toolName?: string) => {
    if (!options.threadId) return;
    getCompanion().setConversationPreview({
      threadId: options.threadId,
      kind,
      text: text.slice(-200),
      ...(toolName ? { toolName } : {}),
    });
  };

  const debouncedTextPreview = (text: string) => {
    lastPreviewText = text;
    if (previewDebounceTimer) return;
    previewDebounceTimer = setTimeout(() => {
      previewDebounceTimer = null;
      sendConversationPreview('responding', lastPreviewText);
    }, 300);
  };

  /** Convert AgentStep to ChatStreamEvent for runTracker + UI emitter. */
  const forwardAgentStep = (step: AgentStep) => {
    // Reasoning streams into its own reasoning part (live "thinking" block);
    // only `kind: 'text'` deltas belong to the answer text.
    if (step.type === 'message_update' && step.kind === 'reasoning') {
      uiChunkEmitter.emitReasoningDelta(step.text);
      return;
    }
    // Emit text deltas via the dedicated ui chunk emitter path
    if (step.type === 'message_update') {
      uiChunkEmitter.emitTextDelta(step.text);
      if (step.kind === 'text') {
        previewText = previewText + step.text;
        debouncedTextPreview(previewText);
      }
      return;
    }

    // Convert AgentStep → ChatStreamEvent-like shape for runTracker and UI
    let event: ChatStreamEvent | null = null;

    if (step.type === 'tool_execution_start') {
      state.turnHadToolCalls = true;
      sendConversationPreview('tool', previewText || ' ', step.toolName);
      event = {
        type: 'tool-call',
        toolCallId: step.toolCallId,
        toolName: step.toolName,
        input: step.input,
      };
    } else if (step.type === 'tool_execution_end') {
      if (step.outcome === 'success') {
        event = {
          type: 'tool-result',
          toolCallId: step.toolCallId,
          output: step.output,
        };
      } else {
        event = {
          type: 'tool-error',
          toolCallId: step.toolCallId,
          error: step.error ?? 'Tool execution failed',
        };
      }
    } else if (step.type === 'approval_request') {
      for (const req of step.requests) {
        if (req.approvalId) {
          deps.approvals.ensurePendingApprovalSession(req.approvalId, {
            target,
            history: state.harness.getHistory() ?? state.streamHistory,
            recoveryContext: state.approvalContext,
          });
        }
      }
      for (const req of step.requests) {
        if (req.approvalId) {
          uiChunkEmitter.emitToolEvent({
            type: 'tool-approval-request',
            approvalId: req.approvalId,
            toolCallId: req.toolCallId || '',
            ...(req.toolCall
              ? {
                  toolCall: {
                    toolName: req.toolCall.toolName,
                    toolCallId: req.toolCallId || '',
                    args: req.toolCall.args ?? {},
                  },
                }
              : {}),
          });
        }
      }
      return;
    } else if (step.type === 'handoff') {
      event = {
        type: 'tool-call',
        toolCallId: `handoff-${state.outerBatch}`,
        toolName: 'handoff',
        input: {
          summary: step.summary,
          nextSteps: step.nextSteps,
          reason: step.reason,
        },
      };
    }

    if (event) {
      state.runTracker?.recordToolEvent(event);
      uiChunkEmitter.emitToolEvent(event);
    }
  };

  try {
    sendConversationPreview('thinking', '');

    // ponytail: clear stale todo plan from previous turn before starting fresh
    writeThreadTodoPlan({ threadId: options.threadId, items: [] });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Run agent via harness — for-await consumes TurnEvent stream
      let agentResult: import('@iki/backend/agent').AgentResult | undefined;
      let cancelled = false;
      let steered = false;
      const awaitingApproval = false;

      try {
        agentResult = await traceChatTurn(
          {
            threadId: options.threadId,
            prompt: state.streamPrompt,
            provider: options.providerType,
            model: options.model,
          },
          () =>
            runWithToolRuntimeContext(
              {
                runId: state.runTracker.id,
                runTracker: state.runTracker,
                threadId: options.threadId,
                conversationModel: {
                  providerType: options.providerType,
                  providerId: options.providerId,
                  model: options.model,
                },
              },
              async () => {
                for await (const event of state.harness.turn({
                  prompt: state.streamPrompt,
                  history: state.streamHistory,
                  runTracker: state.runTracker,
                  abortSignal: streamState.abortController.signal,
                })) {
                  if (event.event === 'step') {
                    forwardAgentStep(event.step);
                    continue;
                  }

                  if (event.event === 'done') {
                    const output = event.output;
                    return {
                      response: output.text,
                      toolCalls: output.toolCalls,
                      toolApprovalRequests: output.toolApprovalRequests,
                      usage: output.usage,
                      ...(output.perf ? { perf: output.perf } : {}),
                      iterations: 0,
                      requiresApproval: output.requiresApproval,
                    } as import('@iki/backend/agent').AgentResult;
                  }
                }
                return undefined;
              }
            ),
          result => result?.response
        );
      } catch (error) {
        if (
          (streamState.steered ?? false) ||
          streamState.cancelled ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          if ((streamState.steered ?? false) && !streamState.cancelled) {
            steered = true;
          } else {
            cancelled = true;
          }
        } else {
          throw error;
        }
      }

      if (steered) {
        streamState.steered = false;
        state.streamHistory = state.harness.getHistory();
        const drained = deps.drainSteerMessages();
        if (drained.length > 0) {
          const steerPrompt =
            drained.length === 1
              ? drained[0]
              : drained.join('\n\n---\n\n');
          state.streamHistory = [
            ...state.streamHistory,
            { role: 'user' as const, content: `[STEERING INPUT]\n\n${steerPrompt}` },
          ];
        }
        streamState.abortController = new AbortController();
        continue;
      }

      if (cancelled) {
        streamResult = { awaitingApproval: false, cancelled: true };
        break;
      }

      if (agentResult?.perf) {
        accumulatedPerf = addTurnPerf(accumulatedPerf, agentResult.perf);
      }

      // Check for approval requests in result
      if (agentResult?.requiresApproval && agentResult.toolApprovalRequests?.length) {
        deps.approvals.registerApprovalBatch(agentResult.toolApprovalRequests, {
          target,
          history: state.harness.getHistory() ?? state.streamHistory,
          ...(state.approvalContext ? { recoveryContext: state.approvalContext } : {}),
        });
        streamResult = {
          awaitingApproval: true,
          response: agentResult.response,
          usage: agentResult.usage,
          perf: accumulatedPerf,
        };
        state.isAwaitingApproval = true;
        break;
      }

      // Build stream result from agent result
      const handoff = agentResult?.toolCalls?.find(
        tc => tc.toolName === 'handoff'
      );
      const terminalToolName = handoff ? 'handoff' : undefined;

      streamResult = {
        awaitingApproval: false,
        ...(agentResult?.response?.trim()
          ? { response: agentResult.response }
          : {}),
        usage: agentResult?.usage,
        perf: accumulatedPerf,
        ...(terminalToolName === 'handoff' && handoff
          ? {
              handoff: {
                summary:
                  typeof (handoff.args as Record<string, unknown>)?.summary === 'string'
                    ? (handoff.args as Record<string, unknown>).summary as string
                    : '',
                nextSteps:
                  typeof (handoff.args as Record<string, unknown>)?.next_steps === 'string'
                    ? (handoff.args as Record<string, unknown>).next_steps as string
                    : '',
                reason:
                  typeof (handoff.args as Record<string, unknown>)?.reason === 'string'
                    ? (handoff.args as Record<string, unknown>).reason as string
                    : 'other',
              },
            }
          : {}),
        ...(terminalToolName ? { finished: true } : {}),
      };

      if (streamResult.response) {
        state.accumulatedResponse = state.accumulatedResponse
          ? state.accumulatedResponse + '\n\n' + streamResult.response
          : streamResult.response;
      }

      if (state.accumulatedResponse) {
        sendConversationPreview('responding', state.accumulatedResponse);
      }
      previewText = '';

      state.runTracker.syncModelMessages(state.harness.getHistory() ?? state.streamHistory);

      if (streamResult.cancelled) break;
      if (streamResult.awaitingApproval) break;
      if (streamResult.partialFailure) break;
      if (streamResult.finished) break;

      if (streamResult.handoff) {
        const handoffText =
          (streamResult.response ? streamResult.response + '\n\n' : '') +
          `[Handoff #${state.handoffChain + 1}] ${streamResult.handoff.summary}`;
        state.accumulatedResponse = state.accumulatedResponse
          ? state.accumulatedResponse + '\n\n---\n\n' + handoffText
          : handoffText;

        state.runTracker.markCompleted({
          text: handoffText.trim() || undefined,
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: 'handoff',
        });
        deps.notifyRunStatus();

        state.handoffChain++;
        if (state.handoffChain >= MAX_HANDOFF_CHAIN || !deps.autonomousMode) break;

        const parentRunId = state.runTracker.id;
        const rootRunId = state.runTracker.getRun().rootRunId;

        state.runTracker = createAgentRunTracker({
          kind: 'handoff-resume',
          threadId: options.threadId,
          parentRunId,
          rootRunId,
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt: deps.systemPrompt,
          enabledTools: preparedTurn.guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          input: {
            prompt: streamResult.handoff.nextSteps || streamResult.handoff.summary,
            messages: [],
            metadata: {
              source: 'handoff',
              parentRunId,
              summary: streamResult.handoff.summary,
              nextSteps: streamResult.handoff.nextSteps,
              reason: streamResult.handoff.reason,
              handoffChain: state.handoffChain,
            },
          },
          working: {
            modelMessages: [],
            accumulatedText: '',
            pendingApprovalIds: [],
            lastStepIndex: 0,
          },
        });
        streamState.runId = state.runTracker.id;

        state.harness = rehydrateHarness({
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt: deps.systemPrompt,
          enableTools: preparedTurn.enableTools,
          enabledToolNames: preparedTurn.guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          guardActive: preparedTurn.guardActive,
          maxIterations: deps.maxIterations,
          threadId: options.threadId,
          maxOutputTokens: preparedTurn.maxOutputTokens,
          ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        });

        state.approvalContext = preparedTurn.enableTools
          ? createApprovalRecoveryContext({
              threadId: options.threadId,
              sessionId: uiChunkEmitter.messageId,
              runId: state.runTracker.id,
              providerType: options.providerType,
              providerId: options.providerId,
              model: options.model,
              systemPrompt: deps.systemPrompt,
              maxInputTokens: preparedTurn.maxInputTokens,
              maxOutputTokens: preparedTurn.maxOutputTokens,
              maxIterations: deps.maxIterations,
              enabledTools: preparedTurn.guardedTools,
              availableSkillIds: preparedTurn.selectedSkillIds,
              ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
              ...(deps.autonomousMode ? { autonomous: options.autonomous } : {}),
            })
          : undefined;

        state.streamHistory = [
          {
            role: 'system',
            content: buildFreshHandoffSystemMessage(streamResult.handoff),
          },
        ];
        state.streamPrompt = streamResult.handoff.nextSteps || 'Continue the work from the handoff summary.';
        continue;
      }
      if (!deps.autonomousMode) break;

      state.outerBatch++;
      if (state.outerBatch >= MAX_OUTER_AUTONOMOUS_BATCHES) break;

      const nextHistory = state.harness.getHistory() ?? state.streamHistory;
      const compacted = autoCompactHistory({
        history: nextHistory,
        maxInputTokens: preparedTurn.maxInputTokens,
      });
      if (compacted.compacted) {
        outerLoopLogger.event({
          level: 'info',
          event: 'chat.stream.auto_compact',
          data: { threadId: options.threadId ?? null, droppedMessages: compacted.droppedCount },
        });
        state.streamHistory = compacted.history;
      } else {
        state.streamHistory = nextHistory;
      }
      state.streamPrompt = options.autonomous?.continuePrompt || 'Continue with the next step.';
    }

    return streamResult;
  } finally {
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
  }
};
