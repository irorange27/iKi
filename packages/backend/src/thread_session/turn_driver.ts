import type { ModelMessage } from '../message/model_history';

import { addTurnPerf, type AgentStep, type AgentTurnPerf } from '@iki/backend/agent';
import type { ConversationPreview } from '@iki/backend/types/companion';
import { traceChatTurn } from '@iki/backend/observability/langfuse';
import { runWithToolRuntimeContext } from '../utils/runtime_context';
import type { TurnDriverHarness, TurnOutput } from '../agent/harness';
import type { AgentRunTracker } from './run_tracker';
import { createAgentRunTracker } from './run_tracker';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import { createApprovalRecoveryContext, reidentifyPlan } from './approval_types';
import type { ExecutionPlan } from './execution_plan';
import { planToRunTrackerParams } from './execution_plan';
import { selectTurnHarness } from './turn_supply_selection';
import {
  MODEL_TEXT_COMMITTED,
  recordFailureTerminalEvent,
  recordSessionEvents,
  STEERING_INPUT_ACCEPTED,
  SESSION_EVENT_VERSION,
  type SteeringInputAcceptedPayload,
  SessionLogCommitError,
  SessionLogWriteError,
  turnFactsToEvents,
} from './session_log';
import { recordInlineToolExecution } from './tool_execution';
import { buildFreshHandoffSystemMessage } from './handoff_resume';
import { getCompanion } from './platform';
import type { ActiveStreamState, ChatStreamEvent, ChatStreamTarget, UiChunkEmitter } from './types';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';

type TurnDriverResultBase = {
  response?: string;
  /** The reply the segment accumulated (a handoff chain's last segment). */
  text?: string;
  usage?: import('@iki/backend/agent').AgentResult['usage'];
  /** Billed input of the final SDK step — the real context size the model last saw. */
  lastStepInputTokens?: number;
  /** Perf metrics accumulated across all batches of the turn. */
  perf?: AgentTurnPerf;
  /** Estimated tokens of the resolved tool schemas (from the harness turn). */
  toolSchemaTokens?: { builtin: number; mcp: number };
  /**
   * Tool calls the harness reported but could not consume — the step budget
   * ran out with them pending. They were EXECUTED (their results are on the
   * transcript) but no model call read them, so the run row carries them:
   * without this field "half an answer" disappears at the harness seam
   * (audit C-1/A-3).
   */
  pendingToolCalls?: import('../agent/runners/pi_agent_loop').PiLoopToolCall[];
};

type HandoffResult = { summary: string; nextSteps: string; reason: string };

/** `AgentResult` plus the remainder the driver reads back out of the harness
 *  turn (see TurnOutput.pendingToolCalls). */
type HarnessTurnResult = import('@iki/backend/agent').AgentResult & {
  pendingToolCalls?: TurnOutput['pendingToolCalls'];
};

export type TurnDriverResult =
  | (TurnDriverResultBase & { outcome: 'completed' })
  | (TurnDriverResultBase & { outcome: 'budget-exhausted' })
  | (TurnDriverResultBase & { outcome: 'awaiting-approval' })
  | (TurnDriverResultBase & { outcome: 'cancelled' })
  | (TurnDriverResultBase & { outcome: 'partial-failure' })
  | (TurnDriverResultBase & { outcome: 'handoff'; handoff: HandoffResult });

/**
 * Mutable per-stream state the turn driver carries across batches. The caller
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
  batchIndex: number;
  handoffChain: number;
  turnHadToolCalls: boolean;
  isAwaitingApproval: boolean;
  /**
   * The facts of the batch that actually ended the turn. The finalize reads
   * THESE rather than the driver's return value: a handoff chain finalizes
   * each parent segment itself with that segment's own outcome, so only the
   * facts here describe the row the entry's finalize will write.
   */
  lastFacts: TurnDriverResultBase;
};

export type TurnDriverDeps = {
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
  /**
   * Called when the executing run identity changes mid-turn (a handoff chain
   * swaps the tracker). The caller re-keys its live-execution registration so
   * cancellation keeps naming the run that is actually executing.
   */
  onRunIdChanged?: (runId: string) => void;
  /**
   * Aliases a delegated child run onto the execution running it (the child
   * inherits this execution's abort signal). Passed through to the tool
   * runtime context so a cancel naming the child reaches this execution,
   * resolved per execution rather than through a process-global hook.
   */
  registerChildRunAlias?: (parentRunId: string, childRunId: string) => () => void;
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
  run: () => Promise<TurnDriverResult | undefined>;
  getRunTracker: () => AgentRunTracker;
  /** The last batch's finish facts — the row the entry finalizes carries
   *  these, whatever the mid-turn segment swaps did. */
  getLastFacts: () => TurnDriverResultBase;
  /** The harness the final batch ran on (differs from the setup's after a
   *  handoff chain) — the entry's history sync must read this one. */
  getHarness: () => TurnDriverHarness;
  getAccumulatedResponse: () => string;
  getBatchCount: () => number;
  hasToolCalls: () => boolean;
  isAwaitingApproval: () => boolean;
};

const MAX_AUTONOMOUS_BATCHES = 50;
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
    : error instanceof SessionLogWriteError
      ? { code: 'SESSION_LOG_WRITE_FAILED', retryable: false }
      : {}),
});

/**
 * ── The one turn-outcome authority ────────────────────────────────────
 *
 * Every way a turn can end is enumerated HERE, once. The run row and the
 * session-log event are two PROJECTIONS of the row below — not two places
 * that decide (audit A-1/A-2: `terminalFactForOutcome` and
 * `finalizeRunForOutcome` used to be two switches that had already drifted
 * apart on the handoff text, and eleven hand-written `mark*` sites owned
 * private copies of the same decision).
 *
 * `terminal` is absent for `awaiting-approval` on purpose: a pause is not
 * terminal, and its continuation records its own facts.
 */
type TurnOutcomeSpec = {
  /** The run row's terminal status. */
  runStatus: AgentRunStatus;
  /** `output.finishReason` on the row and, when terminal, on the event. */
  finishReason?: string;
  /** How the run row reports the failure (failed outcomes only). */
  errorText?: string;
  retryable?: boolean;
  /** Session-log terminal — the event type and its payload's `status` come
   *  from these two; absent means the outcome records no terminal fact. */
  terminal?: { eventKind: 'completed' | 'failed' | 'cancelled'; status: AgentRunStatus };
  /** The single text projection: the row's `output.text`, the event's
   *  `errorText`, and the reply all come from here. */
  text?: (text: string, handoff: HandoffResult | undefined) => string | undefined;
};

const asOptionalText = (text: string): string | undefined => (text ? text : undefined);

/** The handoff reply: the segment's own answer plus the handoff block. */
const handoffText = (text: string, handoff: HandoffResult | undefined): string | undefined =>
  ((text ? text + '\n\n' : '') +
    `[Handoff] ${handoff?.summary ?? ''}\n\nNext steps: ${handoff?.nextSteps ?? ''}`).trim() ||
  undefined;

/**
 * Outcome → (run row, session-log event). Adding a terminal outcome means
 * adding a row here; no entry keeps a private copy of the mapping.
 */
export const TURN_OUTCOMES: Record<TurnDriverResult['outcome'], TurnOutcomeSpec> = {
  completed: {
    runStatus: 'completed',
    finishReason: 'completed',
    terminal: { eventKind: 'completed', status: 'completed' },
    text: asOptionalText,
  },
  'budget-exhausted': {
    // The step budget ran out with work still pending. The turn ENDED — it is
    // not a completed answer, and the remainder rides the row's
    // `pendingToolCalls`.
    runStatus: 'completed',
    finishReason: 'budget-exhausted',
    terminal: { eventKind: 'completed', status: 'completed' },
    text: asOptionalText,
  },
  handoff: {
    runStatus: 'completed',
    finishReason: 'handoff',
    terminal: { eventKind: 'completed', status: 'completed' },
    text: handoffText,
  },
  'awaiting-approval': {
    // Not terminal: the row blocks, the log records nothing, and the
    // continuation (approveTool) records its own facts.
    runStatus: 'blocked',
    finishReason: 'approval-requested',
    text: asOptionalText,
  },
  cancelled: {
    runStatus: 'cancelled',
    finishReason: 'cancelled',
    terminal: { eventKind: 'cancelled', status: 'cancelled' },
    text: asOptionalText,
  },
  'partial-failure': {
    runStatus: 'failed',
    finishReason: 'partial-failure',
    errorText: 'Autonomous iteration failed; partial progress saved.',
    retryable: true,
    terminal: {
      eventKind: 'failed',
      status: 'failed',
    },
  },
};

/** The turn segment handed to a failure finalize (the two terminal facts a
 *  catch/cancel path owns besides a driver outcome). */
/**
 * A terminal failure, as the run row and the log both need it.
 *
 * `code` is NOT decoration: the entries derive it from the caught error
 * (`runFailureFromError`) so a lost write is diagnosable as
 * `SESSION_LOG_COMMIT_FAILED` rather than an anonymous "turn failed". It was
 * dropped between the derivation and this spec, so every entry computed the
 * code and then threw it away.
 */
export type TurnFailureSpec = {
  status: 'failed';
  errorText: string;
  code?: string;
  retryable?: boolean;
};

/** One finalize call's inputs: which outcome, on which row, with which words. */
/** The terminal-writing surface a finalize needs. `AgentRunTracker` satisfies
 *  it, and so does the delegated-agent tool's narrow port — one authority, one
 *  narrow contract, no second tracker type. */
export type TerminalRunTracker = Pick<
  AgentRunTracker,
  'id' | 'getRun' | 'markCompleted' | 'markBlocked' | 'markFailed' | 'markCancelled'
>;

export type FinalizeTurnParams = {
  tracker: TerminalRunTracker;
  outcome: TurnDriverResult['outcome'];
  /** The reply text the entry accumulated (the row's `output.text` source). */
  text?: string;
  usage?: import('@iki/backend/agent').AgentResult['usage'];
  /** The handoff block for the `handoff` outcome. */
  handoff?: HandoffResult;
  /**
   * Calls the step budget left pending. They EXECUTED (their results are on
   * the transcript) but no model call read them, so the turn's text is only
   * part of an answer. Without them `budget-exhausted` is indistinguishable
   * from a complete reply — the audit's A-3 "half an answer vanishes at the
   * harness seam". Written by the SAME projection as the row's status and the
   * log's terminal fact: one outcome, one write.
   */
  pendingToolCalls?: TurnOutput['pendingToolCalls'];
  /** The session log to project into. Omitted = row projection only. */
  threadId?: string;
  /** Which transport the fact records (stream / send / approval-resume). */
  transport: string;
  /**
   * Mark the run row ONLY when it is still mid-flight. A resume/cancel race
   * can have finalized the row already; `markResumed` refuses a
   * terminal → completed transition, so a row that already ended must not be
   * told the outcome again.
   */
  onlyIfRunning?: boolean;
  /** Keep the row un-terminal while still writing the event (the failure-path
   *  discipline of ADR 008 F1: a blocked row stays resumable while its cancel
   *  is recorded). */
  skipRow?: boolean;
  /** Failure-path terminal: never masks the failure being reported. */
  loudGuard?: boolean;
  /** The committed message to record alongside the terminal fact. */
  committed?: {
    messageId: string;
    message: never;
  };
  notify?: () => void;
};

/** The two projections one finalize writes, derived from one table row. */
const projectTurnOutcome = (
  outcome: TurnDriverResult['outcome'],
  text: string,
  handoff: HandoffResult | undefined
): {
  spec: TurnOutcomeSpec;
  text: string | undefined;
  terminalFact?: {
    status: AgentRunStatus;
    finishReason?: string;
    errorText?: string;
  };
  eventKind?: 'completed' | 'failed' | 'cancelled';
} => {
  const spec = TURN_OUTCOMES[outcome];
  const projected = spec.text?.(text, handoff);
  const terminalFact = spec.terminal
    ? {
        status: spec.terminal.status,
        ...(spec.finishReason ? { finishReason: spec.finishReason } : {}),
        ...(spec.errorText ? { errorText: spec.errorText } : {}),
      }
    : undefined;
  return { spec, text: projected, ...(terminalFact ? { terminalFact } : {}), eventKind: spec.terminal?.eventKind };
};

/**
 * The single finalize: writes the run row and the session-log terminal from
 * ONE row of `TURN_OUTCOMES`. Every entry (stream, send, approval resume) and
 * every failure path calls this instead of hand-writing `mark*` calls.
 */
export const finalizeTurn = (params: FinalizeTurnParams): void => {
  const { tracker, outcome, transport } = params;
  const projection = projectTurnOutcome(outcome, params.text ?? '', params.handoff);
  const { spec } = projection;
  const status = tracker.getRun().status;
  const writable = !params.skipRow && (!params.onlyIfRunning || status === 'running');

  // ── projection 1 (EVENT-FIRST) — the session log ───────────────────
  //
  // ORDER IS THE CONTRACT (ADR 008 F1): the facts reach the log BEFORE the row
  // goes terminal. If the append fails it throws, the entry's catch marks the
  // run failed, and the turn reports failure — a row that already said
  // `completed` could never be taken back, so a lost fact surfaced as a
  // successful turn whose history was missing its own outcome. That is exactly
  // what `session-log_write_discipline` and `session_log_commit_failure` pin;
  // this function used to write the row first.
  if (params.threadId && projection.terminalFact && projection.eventKind) {
    const record = params.loudGuard ? recordFailureTerminalEvent : recordSessionEvents;
    record(
      params.threadId,
      turnFactsToEvents({
        ...(params.committed
          ? {
              committed: {
                runId: tracker.id,
                messageId: params.committed.messageId,
                message: params.committed.message,
                transport,
              },
            }
          : {}),
        terminal: { runId: tracker.id, ...projection.terminalFact },
      })
    );
  }
  // ── projection 2: the run row ──────────────────────────────────────
  if (writable) {
    if (spec.runStatus === 'completed') {
      tracker.markCompleted({
        ...(projection.text ? { text: projection.text } : {}),
        ...(params.usage ? { usage: { ...params.usage } } : {}),
        ...(spec.finishReason ? { finishReason: spec.finishReason } : {}),
        ...(params.pendingToolCalls && params.pendingToolCalls.length > 0
          ? { pendingToolCalls: params.pendingToolCalls }
          : {}),
      });
    } else if (spec.runStatus === 'blocked') {
      tracker.markBlocked({
        ...(projection.text ? { text: projection.text } : {}),
        ...(params.usage ? { usage: { ...params.usage } } : {}),
        ...(spec.finishReason ? { finishReason: spec.finishReason } : {}),
      });
    } else if (spec.runStatus === 'cancelled') {
      tracker.markCancelled({ ...(projection.text ? { text: projection.text } : {}) });
    } else {
      tracker.markFailed({
        message: spec.errorText ?? 'Turn failed.',
        ...(spec.retryable !== undefined ? { retryable: spec.retryable } : {}),
      });
    }
  }

  params.notify?.();
};

/**
 * A failure that never produced a driver outcome (the turn threw, or a cancel
 * or lease loss landed outside the driver's own loop). It goes through the
 * SAME row and the SAME projection as the driver outcomes — the two
 * terminal-fact shapes this file's entries used to write by hand are rows
 * here.
 */
export const finalizeTurnFailure = (
  params: Omit<FinalizeTurnParams, 'outcome'> & { failure: TurnFailureSpec }
): void => {
  const { tracker, failure, transport } = params;
  if (!params.skipRow) {
    tracker.markFailed({
      message: failure.errorText,
      ...(failure.code ? { code: failure.code } : {}),
      ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),
      // The text the turn DID generate before failing. It is not published
      // (the commit gate withheld it) and must not enter history, but the run
      // row keeps it in `working.accumulatedText` so a diagnosed failure can
      // be told apart from one that produced nothing.
      ...(typeof params.text === 'string' && params.text.length > 0
        ? { text: params.text }
        : {}),
    });
  }
  if (params.threadId) {
    const record = params.loudGuard ? recordFailureTerminalEvent : recordSessionEvents;
    record(
      params.threadId,
      turnFactsToEvents({
        ...(params.committed
          ? {
              committed: {
                runId: tracker.id,
                messageId: params.committed.messageId,
                message: params.committed.message,
                transport,
              },
            }
          : {}),
        terminal: {
          runId: tracker.id,
          status: failure.status,
          errorText: failure.errorText,
        },
      })
    );
  }
  params.notify?.();
};

/**
 * The terminal of a harness turn the DRIVER did not run (the delegated-agent
 * tool's child run, issue #145's out-of-band executor). It goes through the
 * same table: a harness that stopped with tool calls pending did not finish
 * its answer, so it finalizes `budget-exhausted` — the child used to report
 * `completed` for every non-throwing turn, whatever its budget outcome.
 */
export const finalizeHarnessTurn = (params: {
  tracker: TerminalRunTracker;
  output: { text: string; usage?: import('@iki/backend/agent').AgentResult['usage']; finishReason?: string };
  transport: string;
}): void => {
  const outcome: TurnDriverResult['outcome'] =
    params.output.finishReason === 'tool-calls' ? 'budget-exhausted' : 'completed';
  finalizeTurn({
    tracker: params.tracker,
    outcome,
    text: params.output.text,
    ...(params.output.usage ? { usage: params.output.usage } : {}),
    transport: params.transport,
  });
};

/** The stop/cancel pair of a turn that ended by cancellation rather than by
 *  the driver's own loop (blocked-then-cancelled, resume cancelled). */
export const finalizeTurnCancelled = (
  params: Omit<FinalizeTurnParams, 'outcome'> & { keepRowStatus?: AgentRunStatus }
): void => {
  const { tracker, transport } = params;
  if (!params.skipRow && !params.keepRowStatus) {
    tracker.markCancelled({ ...(params.text ? { text: params.text } : {}) });
  }
  if (params.threadId) {
    const record = params.loudGuard ? recordFailureTerminalEvent : recordSessionEvents;
    record(
      params.threadId,
      turnFactsToEvents({
        ...(params.committed
          ? {
              committed: {
                runId: tracker.id,
                messageId: params.committed.messageId,
                message: params.committed.message,
                transport,
              },
            }
          : {}),
        terminal: { runId: tracker.id, status: 'cancelled' },
      })
    );
  }
  params.notify?.();
};

/**
 * The turn driver (ADR 004): one harness.turn() per batch — steer restart,
 * approval blocking, handoff chaining, and batch-boundary auto-compaction.
 * Mutates `state` in place; the caller owns catch/finally and run
 * finalization.
 */
const runTurnBatches = async (
  state: TurnDriverState,
  deps: TurnDriverDeps,
): Promise<TurnDriverResult | undefined> => {
  const { target, plan, streamState, uiChunkEmitter } = deps;
  const threadId = plan.threadId;
  // The BATCH budget (ADR 004). It says nothing about the step budget: a
  // step-exhausted batch with no batch bound is a finished turn, not a
  // continuation.
  const batch = plan.budget.batch;
  const autonomousMode = Boolean(batch && batch.max > 1);
  const previewEnabled = deps.conversationPreview !== false;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previewText = '';
  let lastPreviewText = '';
  let streamResult: TurnDriverResult | undefined;
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
    // a successful turn's teardown. The gate keeps its own error contract:
    // the withheld text rides the error so the UI can offer it.
    try {
      recordSessionEvents(threadId, [
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
    } catch (error) {
      throw new SessionLogCommitError(text, previewText, { cause: error });
    }
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
        toolCallId: `handoff-${state.batchIndex}`,
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
      let agentResult: HarnessTurnResult | undefined;
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
                ...(deps.registerChildRunAlias
                  ? { registerChildRunAlias: deps.registerChildRunAlias }
                  : {}),
              },
              async () => {
                for await (const event of state.harness.turn({
                  prompt: state.streamPrompt,
                  history: state.streamHistory,
                  runId: state.runTracker.id,
                  recordInlineExecution: ({ runId, toolCallId, toolName, args, output }) =>
                    recordInlineToolExecution({
                      threadId,
                      runId,
                      toolCallId,
                      toolName,
                      args,
                      output,
                    }),
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
                      ...(output.pendingToolCalls && output.pendingToolCalls.length > 0
                        ? { pendingToolCalls: output.pendingToolCalls }
                        : {}),
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
                      ...(output.pendingToolCalls
                        ? { pendingToolCalls: output.pendingToolCalls }
                        : {}),
                    } as HarnessTurnResult;
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
          // The steering input is a business fact like any other accepted
          // input: recording it keeps the session log the authority for what
          // the human asked for, so a recovery replay reconstructs the same
          // conversation the live turn saw (audit H6).
          const steeringPayload: SteeringInputAcceptedPayload = {
            runId: state.runTracker.id,
            // Distinct from the assistant message id: the assistant's
            // MODEL_OUTPUT_COMMITTED fact carries its own id, and reusing it
            // here would let that later fact overwrite this message in the
            // rebuilt conversation — losing the steer again.
            messageId: `steer_${state.runTracker.id}_${state.batchIndex}`,
            batchIndex: state.batchIndex,
            text: steerPrompt,
          };
          recordSessionEvents(threadId, [
            {
              type: STEERING_INPUT_ACCEPTED,
              version: SESSION_EVENT_VERSION,
              payload: steeringPayload as unknown as Record<string, unknown>,
            },
          ]);
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
        state.lastFacts = {
          text: state.accumulatedResponse || agentResult.response,
          ...(agentResult.usage ? { usage: agentResult.usage } : {}),
        };
        break;
      }

      // Build stream result from agent result
      const handoff = agentResult?.toolCalls?.find(
        tc => tc.toolName === 'handoff'
      );

      const resultBase: TurnDriverResultBase = {
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
        ...(agentResult?.pendingToolCalls && agentResult.pendingToolCalls.length > 0
          ? { pendingToolCalls: agentResult.pendingToolCalls }
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
        // `tool-calls` is the harness saying "I stopped with calls still
        // pending" — its step budget ran out. That is a terminal outcome, not
        // an internal continuation: the batch bound below may open another
        // batch, but the turn's own answer is `budget-exhausted`.
        streamResult = {
          ...resultBase,
          outcome: agentResult?.finishReason === 'tool-calls' ? 'budget-exhausted' : 'completed',
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

      // TERMINAL outcomes end the batch loop here. `budget-exhausted` is NOT
      // one of them: it is the outcome of the batch that just ran (its step
      // budget ran out), and the batch bound below may open another batch to
      // finish the work. Breaking here would make `budget-exhausted` final
      // even when the turn still had batches left, which is how the
      // continuation silently stopped after one batch.
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

        state.handoffChain++;
        const parentRunId = state.runTracker.id;
        const chainContinues = state.handoffChain < MAX_HANDOFF_CHAIN && autonomousMode;
        // The parent segment's terminal is the SAME outcome as the turn's:
        // both projections are written from the `handoff` row, so the row and
        // the log cannot disagree on status, finishReason or error text
        // (audit A-2's divergence). A chain that stops here leaves the final
        // finalize to the entry, exactly as a non-chained turn does.
        finalizeTurn({
          tracker: state.runTracker,
          outcome: 'handoff',
          text: handoffText,
          ...(streamResult.usage ? { usage: streamResult.usage } : {}),
          handoff: streamResult.handoff,
          ...(chainContinues ? { threadId } : {}),
          transport: plan.transport,
          notify: deps.notifyRunStatus,
        });

        if (!chainContinues) {
          // The chained batch would have been the last one anyway; the entry's
          // finalize writes the same `handoff` row again — markCompleted is
          // idempotent for one run, and the entry owns the reply text.
          break;
        }

        state.runTracker = createAgentRunTracker(
          planToRunTrackerParams(
            reidentifyPlan(deps.plan, { kind: 'handoff-resume', parentRunId }),
            {
              input: {
                prompt: streamResult.handoff.nextSteps || streamResult.handoff.summary,
                messages: [],
              },
              working: {
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
        // The live-execution index follows the chain: a cancel naming the
        // chained segment must reach the same execution, not a dead parent.
        deps.onRunIdChanged?.(state.runTracker.id);
        // The chained segment's start is the same kind of lifecycle fact the
        // entries write for a fresh turn. Without it a terminal-only record
        // would materialize this turn with a defaulted kind.
        recordSessionEvents(threadId, turnFactsToEvents({
          started: {
            runId: state.runTracker.id,
            kind: 'handoff-resume',
            plan: reidentifyPlan(deps.plan, { kind: 'handoff-resume', parentRunId }),
          },
        }));

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
      // The facts of the batch that is actually last. They are recorded
      // BEFORE the batch gates below, which may let another batch supersede
      // them — the superseding batch overwrites this with its own facts, so
      // an entry always finalizes the row it is really finalizing (audit A-1:
      // the old code turned this into `budget-exhausted` only inside the
      // autonomous branch, so a non-autonomous turn escaped as a silent
      // `completed`).
      state.lastFacts = {
        text: state.accumulatedResponse || streamResult.response,
        ...(streamResult.usage ? { usage: streamResult.usage } : {}),
        ...(streamResult.pendingToolCalls && streamResult.pendingToolCalls.length > 0
          ? { pendingToolCalls: streamResult.pendingToolCalls }
          : {}),
      };

      // Only a step-budget exhaustion continues: "only exhausted tool steps
      // may continue within the requested batch bound" (README's stop
      // contract). A batch bound of 1 is a single-batch turn.
      if (!autonomousMode || streamResult.outcome !== 'budget-exhausted') break;

      state.batchIndex++;
      if (state.batchIndex >= Math.min(MAX_AUTONOMOUS_BATCHES, batch?.max ?? MAX_AUTONOMOUS_BATCHES)) {
        // The batch bound is exhausted: this batch's own outcome stands.
        break;
      }

      state.streamHistory = state.harness.getHistory();
      state.streamPrompt = batch?.continuePrompt || 'Continue with the next step.';
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
  deps: TurnDriverDeps
): TurnDriverHandle => {
  const state: TurnDriverState = {
    ...setup,
    accumulatedResponse: '',
    batchIndex: 0,
    handoffChain: 0,
    turnHadToolCalls: false,
    isAwaitingApproval: false,
    lastFacts: {},
  };
  return {
    run: () => runTurnBatches(state, deps),
    getRunTracker: () => state.runTracker,
    getLastFacts: () => state.lastFacts,
    getHarness: () => state.harness,
    getAccumulatedResponse: () => state.accumulatedResponse,
    getBatchCount: () => state.batchIndex,
    hasToolCalls: () => state.turnHadToolCalls,
    isAwaitingApproval: () => state.isAwaitingApproval,
  };
};
