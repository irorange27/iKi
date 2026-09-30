import type { ModelMessage } from 'ai';

import { addTurnPerf, type AgentStep, type AgentTurnPerf } from '@iki/backend/agent';
import type { ConversationPreview } from '@iki/backend/types/companion';
import { traceChatTurn } from '@iki/backend/observability/langfuse';
import { runWithToolRuntimeContext } from '../utils/runtime_context';
import { rehydrateHarness, type AgentHarness } from '../agent/harness';
import type { AgentRunTracker } from './run_tracker';
import { createAgentRunTracker } from './run_tracker';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import { createApprovalRecoveryContext } from './approval_types';
import type { ChatTurnOptions, PreparedChatTurn } from '../turn_prep/turn_preparer';
import { buildFreshHandoffSystemMessage } from './handoff_resume';
import { getCompanion } from './platform';
import { writeThreadTodoPlan } from '../db/thread_todos';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import type { ActiveStreamState, ChatStreamEvent, ChatStreamTarget, UiChunkEmitter } from './types';

type OuterLoopStreamResultBase = {
  response?: string;
  usage?: import('@iki/backend/agent').AgentResult['usage'];
  /** Billed input of the final SDK step — the real context size the model last saw. */
  lastStepInputTokens?: number;
  /** Perf metrics accumulated across all outer batches of the turn. */
  perf?: AgentTurnPerf;
  /** Estimated tokens of the resolved tool schemas (from the harness turn). */
  toolSchemaTokens?: { builtin: number; mcp: number };
};

type HandoffResult = { summary: string; nextSteps: string; reason: string };

export type OuterLoopStreamResult =
  | (OuterLoopStreamResultBase & { outcome: 'continuing' })
  | (OuterLoopStreamResultBase & { outcome: 'completed' })
  | (OuterLoopStreamResultBase & { outcome: 'budget-exhausted' })
  | (OuterLoopStreamResultBase & { outcome: 'awaiting-approval' })
  | (OuterLoopStreamResultBase & { outcome: 'cancelled' })
  | (OuterLoopStreamResultBase & { outcome: 'partial-failure' })
  | (OuterLoopStreamResultBase & { outcome: 'handoff'; handoff: HandoffResult });

/**
 * Mutable per-stream state the outer loop drives across batches. The caller
 * builds it after turn preparation and reads the final values for finalize
 * and cleanup.
 */
type TurnDriverState = {
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
  /** Called after each completed tool execution so the durable assistant
   *  record carries mid-turn tool progress (crash recovery relies on it). */
  onToolActivity?: () => void;
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

export type TurnDriverSetup = Pick<
  TurnDriverState,
  'harness' | 'runTracker' | 'approvalContext' | 'streamHistory' | 'streamPrompt'
>;

export type TurnDriverHandle = {
  run: () => Promise<OuterLoopStreamResult | undefined>;
  getRunTracker: () => AgentRunTracker;
  getAccumulatedResponse: () => string;
  getOuterBatchCount: () => number;
  hasToolCalls: () => boolean;
  isAwaitingApproval: () => boolean;
};

const MAX_OUTER_AUTONOMOUS_BATCHES = 50;
const MAX_HANDOFF_CHAIN = 5;

/**
 * The outer autonomous loop (ADR 004): one harness.turn() per batch,
 * autonomous mode only, with steer restart, approval blocking, handoff
 * chaining, and batch-boundary auto-compaction. Mutates `state` in place;
 * the caller owns catch/finally and run finalization.
 */
const runOuterLoop = async (
  state: TurnDriverState,
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

  /** Project AgentStep facts into the UI stream event shape. */
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

    // Convert AgentStep to the typed UI projection event.
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
      state.runTracker.recordAgentStep(step);
      uiChunkEmitter.emitToolEvent(event);
      if (event.type === 'tool-result' || event.type === 'tool-error') {
        deps.onToolActivity?.();
      }
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
                  onInference: record => state.runTracker.recordModelStep(record),
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
                      ...(output.lastStepInputTokens != null
                        ? { lastStepInputTokens: output.lastStepInputTokens }
                        : {}),
                      ...(output.perf ? { perf: output.perf } : {}),
                      ...(output.toolSchemaTokens
                        ? { toolSchemaTokens: output.toolSchemaTokens }
                        : {}),
                      iterations: 0,
                      requiresApproval: output.requiresApproval,
                      finishReason: output.finishReason,
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
        state.streamPrompt = '';
        continue;
      }

      if (cancelled) {
        streamResult = { outcome: 'cancelled' };
        break;
      }

      if (agentResult?.perf) {
        accumulatedPerf = addTurnPerf(accumulatedPerf, agentResult.perf);
      }

      // Check for approval requests in result
      if (agentResult?.requiresApproval && agentResult.toolApprovalRequests?.length) {
        state.runTracker.syncModelMessages(state.harness.getHistory() ?? state.streamHistory);
        deps.approvals.registerApprovalBatch(agentResult.toolApprovalRequests, {
          target,
          history: state.harness.getHistory() ?? state.streamHistory,
          ...(state.approvalContext ? { recoveryContext: state.approvalContext } : {}),
        });
        state.runTracker.recordAgentStep({
          type: 'approval_request',
          requests: agentResult.toolApprovalRequests,
        });
        streamResult = {
          outcome: 'awaiting-approval',
          response: agentResult.response,
          usage: agentResult.usage,
          ...(agentResult.lastStepInputTokens != null
            ? { lastStepInputTokens: agentResult.lastStepInputTokens }
            : {}),
          perf: accumulatedPerf,
          ...(agentResult.toolSchemaTokens
            ? { toolSchemaTokens: agentResult.toolSchemaTokens }
            : {}),
        };
        state.isAwaitingApproval = true;
        break;
      }

      // Build stream result from agent result
      const handoff = agentResult?.toolCalls?.find(
        tc => tc.toolName === 'handoff'
      );

      const resultBase: OuterLoopStreamResultBase = {
        ...(agentResult?.response?.trim()
          ? { response: agentResult.response }
          : {}),
        usage: agentResult?.usage,
        ...(agentResult?.lastStepInputTokens != null
          ? { lastStepInputTokens: agentResult.lastStepInputTokens }
          : {}),
        perf: accumulatedPerf,
        ...(agentResult?.toolSchemaTokens
          ? { toolSchemaTokens: agentResult.toolSchemaTokens }
          : {}),
      };
      if (handoff) {
        const args = handoff.args as Record<string, unknown>;
        streamResult = {
          ...resultBase,
          outcome: 'handoff',
          handoff: {
            summary: typeof args.summary === 'string' ? args.summary : '',
            nextSteps: typeof args.next_steps === 'string' ? args.next_steps : '',
            reason: typeof args.reason === 'string' ? args.reason : 'other',
          },
        };
      } else {
        streamResult = {
          ...resultBase,
          outcome: agentResult?.finishReason === 'tool-calls' ? 'continuing' : 'completed',
        };
      }

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

      if (
        streamResult.outcome === 'cancelled' ||
        streamResult.outcome === 'awaiting-approval' ||
        streamResult.outcome === 'partial-failure' ||
        streamResult.outcome === 'completed'
      ) break;

      if (streamResult.outcome === 'handoff') {
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
              approvalPolicy: parseApprovalPolicy(options.approvalPolicy),
              requireApproval: preparedTurn.requireApproval,
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
          requireApproval: preparedTurn.requireApproval,
          autoApproveToolRequests: preparedTurn.autoApproveToolRequests,
          approvalPolicy: parseApprovalPolicy(options.approvalPolicy) ?? undefined,
          maxIterations: deps.maxIterations,
          threadId: options.threadId,
          maxOutputTokens: preparedTurn.maxOutputTokens,
          maxInputTokens: preparedTurn.maxInputTokens,
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
              maxOutputTokens: preparedTurn.maxOutputTokens,
              maxInputTokens: preparedTurn.maxInputTokens,
              maxIterations: deps.maxIterations,
              approvalPolicy: parseApprovalPolicy(options.approvalPolicy) ?? undefined,
              requireApproval: preparedTurn.requireApproval,
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
      if (state.outerBatch >= Math.min(
        MAX_OUTER_AUTONOMOUS_BATCHES,
        options.autonomous?.maxIterations ?? MAX_OUTER_AUTONOMOUS_BATCHES,
      )) break;

      state.streamHistory = state.harness.getHistory();
      state.streamPrompt = options.autonomous?.continuePrompt || 'Continue with the next step.';
    }

    if (streamResult?.outcome === 'continuing') {
      streamResult = { ...streamResult, outcome: 'budget-exhausted' };
    }
    return streamResult;
  } finally {
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
  }
};

export const createTurnDriver = (
  setup: TurnDriverSetup,
  deps: OuterLoopDeps
): TurnDriverHandle => {
  const state: TurnDriverState = {
    ...setup,
    accumulatedResponse: '',
    outerBatch: 0,
    handoffChain: 0,
    turnHadToolCalls: false,
    isAwaitingApproval: false,
  };
  return {
    run: () => runOuterLoop(state, deps),
    getRunTracker: () => state.runTracker,
    getAccumulatedResponse: () => state.accumulatedResponse,
    getOuterBatchCount: () => state.outerBatch,
    hasToolCalls: () => state.turnHadToolCalls,
    isAwaitingApproval: () => state.isAwaitingApproval,
  };
};
