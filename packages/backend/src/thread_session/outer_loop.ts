import type { ModelMessage } from 'ai';

import { addTurnPerf, type AgentStep, type AgentTurnPerf } from '@iki/backend/agent';
import type { ConversationPreview } from '@iki/backend/types/companion';
import { traceChatTurn } from '@iki/backend/observability/langfuse';
import { runWithToolRuntimeContext } from '../utils/runtime_context';
import type { TurnDriverHarness } from '../agent/harness';
import type { AgentRunTracker } from './run_tracker';
import { createAgentRunTracker } from './run_tracker';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import { createApprovalRecoveryContext, reidentifyPlan } from './approval_types';
import type { ExecutionPlan } from './execution_plan';
import { planToRunTrackerParams } from './execution_plan';
import { selectTurnHarness } from './turn_supply_selection';
import { MODEL_TEXT_COMMITTED, recordSessionEvents, SESSION_EVENT_VERSION, SessionLogCommitError } from './session_log';
import { buildFreshHandoffSystemMessage } from './handoff_resume';
import { getCompanion } from './platform';
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
  /** Structural surface (AgentHarness or a switch-item harness) — the driver
   * must not know which supply served the turn. */
  harness: TurnDriverHarness;
  runTracker: AgentRunTracker;
  approvalContext?: ApprovalRecoveryContext;
  streamHistory: ModelMessage[];
  streamPrompt: string;
  /**
   * The turn-start workspace binding (D30), shared across every batch of the
   * turn — including handoff-resumed harnesses — so a mid-turn workspace
   * switch never redirects this turn's tools.
   */
  workspaceSelectionBox?: { selection: unknown };
  accumulatedResponse: string;
  outerBatch: number;
  handoffChain: number;
  turnHadToolCalls: boolean;
  isAwaitingApproval: boolean;
};

export type OuterLoopDeps = {
  target: ChatStreamTarget;
  /** The typed definition of this execution (see execution_plan.ts). */
  plan: ExecutionPlan;
  streamState: ActiveStreamState;
  uiChunkEmitter: UiChunkEmitter;
  notifyRunStatus: () => void;
  drainSteerMessages: () => string[];
  /** Conversation-preview projection (companion UI). Entries without a
   *  visible subscriber (send, approval resume) turn it off. */
  conversationPreview?: boolean;
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
  'harness' | 'runTracker' | 'approvalContext' | 'streamHistory' | 'streamPrompt' | 'workspaceSelectionBox'
>;

export type TurnDriverHandle = {
  run: () => Promise<OuterLoopStreamResult | undefined>;
  getRunTracker: () => AgentRunTracker;
  /** The harness the final batch ran on (differs from the setup's after a
   *  handoff chain) — the entry's history sync must read this one. */
  getHarness: () => TurnDriverHarness;
  getAccumulatedResponse: () => string;
  getOuterBatchCount: () => number;
  hasToolCalls: () => boolean;
  isAwaitingApproval: () => boolean;
};

const MAX_OUTER_AUTONOMOUS_BATCHES = 50;
const MAX_HANDOFF_CHAIN = 5;

/**
 * How long streamed text may stay in the commit buffer before it is written
 * to the session log and only then published (D22: shown ⊆ committed). The
 * batch granularity trades display latency for write frequency — the draft
 * leaves it to measurement, this is the initial value.
 */
const TEXT_COMMIT_INTERVAL_MS = 250;

export const runFailureFromError = (error: unknown, message: string) => ({
  message,
  ...(error instanceof SessionLogCommitError
    ? {
        code: 'SESSION_LOG_COMMIT_FAILED',
        retryable: false,
        ...(error.generatedText ? { text: error.generatedText } : {}),
      }
    : {}),
});

/**
 * The authoritative terminal-outcome mapping: one place decides what each
 * OuterLoopStreamResult outcome means for the run row. Every entry that runs
 * the driver finalizes through this — adding a terminal outcome means
 * changing this switch and the per-transport projection adapters, not each
 * entry's private finalize code.
 */
export const finalizeRunForOutcome = (
  tracker: AgentRunTracker,
  result: OuterLoopStreamResult,
  params: { text?: string; notify?: () => void } = {}
): void => {
  const text = params.text ?? result.response;
  if (result.outcome === 'cancelled') {
    tracker.markCancelled({ ...(text ? { text } : {}) });
  } else if (result.outcome === 'partial-failure') {
    tracker.markFailed({
      message: 'Autonomous iteration failed; partial progress saved.',
      retryable: true,
    });
  } else if (result.outcome === 'awaiting-approval') {
    tracker.markBlocked({
      ...(text ? { text } : {}),
      usage: result.usage ? { ...result.usage } : undefined,
    });
  } else if (result.outcome === 'handoff') {
    const handoffResponse =
      (text ? text + '\n\n' : '') +
      `[Handoff] ${result.handoff.summary}\n\nNext steps: ${result.handoff.nextSteps}`;
    tracker.markCompleted({
      text: handoffResponse.trim() || undefined,
      usage: result.usage ? { ...result.usage } : undefined,
      finishReason: 'handoff',
    });
  } else {
    tracker.markCompleted({
      ...(text ? { text } : {}),
      usage: result.usage ? { ...result.usage } : undefined,
      finishReason: result.outcome === 'budget-exhausted' ? 'budget-exhausted' : 'completed',
    });
  }
  params.notify?.();
};

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
  const { target, plan, streamState, uiChunkEmitter } = deps;
  const threadId = plan.threadId;
  const autonomousMode = Boolean(plan.autonomous && plan.autonomous.maxIterations > 1);
  const previewEnabled = deps.conversationPreview !== false;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previewText = '';
  let lastPreviewText = '';
  let streamResult: OuterLoopStreamResult | undefined;
  let accumulatedPerf: AgentTurnPerf | undefined;

  const sendConversationPreview = (kind: ConversationPreview['kind'], text: string, toolName?: string) => {
    if (!previewEnabled || !threadId) return;
    getCompanion().setConversationPreview({
      threadId,
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

  // ── Text commit gate (D22) ──────────────────────────────────────────
  // Streamed text lands in a buffer first; a flush writes it to the session
  // log and only then publishes the chunks to the subscriber. Shown text is
  // therefore always already committed. Flushes fire at segment boundaries
  // (tool/approval/handoff steps), on the interval, and before the turn's
  // result returns — a crash can lose at most the unpublished buffer tail,
  // never anything the subscriber saw.
  let pendingText = '';
  let pendingTextSeq = 0;
  let lastTextFlushAt = Date.now();
  const flushCommittedText = () => {
    if (!pendingText) return;
    const text = pendingText;
    lastTextFlushAt = Date.now();
    // A failed commit ends execution; an unpublished buffer cannot survive
    // a successful turn's teardown.
    const committed = recordSessionEvents(threadId, [
      {
        type: MODEL_TEXT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: state.runTracker.id,
          messageId: uiChunkEmitter.messageId,
          seq: pendingTextSeq,
          text,
        },
      },
    ]);
    if (!committed) throw new SessionLogCommitError(text, previewText);
    pendingText = '';
    pendingTextSeq += 1;
    uiChunkEmitter.emitTextDelta(text);
  };
  const bufferStreamedText = (text: string) => {
    pendingText += text;
    if (Date.now() - lastTextFlushAt >= TEXT_COMMIT_INTERVAL_MS) flushCommittedText();
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
      bufferStreamedText(step.text);
      if (step.kind === 'text') {
        previewText = previewText + step.text;
        debouncedTextPreview(previewText);
      }
      return;
    }

    // Segment boundary: everything buffered is committed and published
    // before a non-text fact (tool, approval, handoff) hits the stream.
    flushCommittedText();

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

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Run agent via harness — for-await consumes TurnEvent stream
      let agentResult: import('@iki/backend/agent').AgentResult | undefined;
      let cancelled = false;
      let steered = false;

      try {
        agentResult = await traceChatTurn(
          {
            threadId,
            prompt: state.streamPrompt,
            provider: plan.providerType,
            model: plan.model,
          },
          () =>
            runWithToolRuntimeContext(
              {
                runId: state.runTracker.id,
                runTracker: state.runTracker,
                threadId,
                conversationModel: {
                  providerType: plan.providerType,
                  providerId: plan.providerId,
                  model: plan.model,
                },
                ...(state.workspaceSelectionBox
                  ? { workspaceSelectionBox: state.workspaceSelectionBox }
                  : {}),
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
        flushCommittedText();
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
        // Defensive: the runner yields the handoff step after the stream
        // loop, so the buffer is empty here today — the flush keeps the
        // runId-at-flush invariant local instead of pinned to that order.
        flushCommittedText();
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
        if (state.handoffChain >= MAX_HANDOFF_CHAIN || !autonomousMode) break;

        const parentRunId = state.runTracker.id;

        state.runTracker = createAgentRunTracker(
          planToRunTrackerParams(
            reidentifyPlan(deps.plan, { kind: 'handoff-resume', parentRunId }),
            {
              input: {
                prompt: streamResult.handoff.nextSteps || streamResult.handoff.summary,
                messages: [],
              },
              working: {
                modelMessages: [],
                accumulatedText: '',
                pendingApprovalIds: [],
                lastStepIndex: 0,
              },
              metadataExtras: {
                source: 'handoff',
                parentRunId,
                summary: streamResult.handoff.summary,
                nextSteps: streamResult.handoff.nextSteps,
                reason: streamResult.handoff.reason,
                handoffChain: state.handoffChain,
              },
            }
          )
        );
        streamState.runId = state.runTracker.id;

        // The chained batch resumes with a fresh [HANDOFF CONTEXT] history —
        // built BEFORE the harness so the supply selection gates against the
        // history the new harness will actually receive (switch item 3c: one
        // selection point decides every batch — no mid-chain supply flip).
        state.streamHistory = [
          {
            role: 'system',
            content: buildFreshHandoffSystemMessage(streamResult.handoff),
          },
        ];
        state.harness = selectTurnHarness(deps.plan, state.streamHistory);

        state.approvalContext = deps.plan.enableTools
          ? createApprovalRecoveryContext({
              plan: reidentifyPlan(deps.plan, { kind: 'handoff-resume', parentRunId }),
              sessionId: uiChunkEmitter.messageId,
              runId: state.runTracker.id,
            })
          : undefined;

        state.streamPrompt = streamResult.handoff.nextSteps || 'Continue the work from the handoff summary.';
        continue;
      }
      if (!autonomousMode) break;

      state.outerBatch++;
      if (state.outerBatch >= Math.min(
        MAX_OUTER_AUTONOMOUS_BATCHES,
        plan.autonomous?.maxIterations ?? MAX_OUTER_AUTONOMOUS_BATCHES,
      )) break;

      state.streamHistory = state.harness.getHistory();
      state.streamPrompt = plan.autonomous?.continuePrompt || 'Continue with the next step.';
    }

    if (streamResult?.outcome === 'continuing') {
      streamResult = { ...streamResult, outcome: 'budget-exhausted' };
    }
    return streamResult;
  } finally {
    // Error paths (provider failure, cancellation) exit through here with
    // text still buffered. Flushing keeps the invariant on the failure path:
    // whatever gets published around the error was committed first, and the
    // log covers the subscriber's final view.
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
    flushCommittedText();
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
    getHarness: () => state.harness,
    getAccumulatedResponse: () => state.accumulatedResponse,
    getOuterBatchCount: () => state.outerBatch,
    hasToolCalls: () => state.turnHadToolCalls,
    isAwaitingApproval: () => state.isAwaitingApproval,
  };
};
