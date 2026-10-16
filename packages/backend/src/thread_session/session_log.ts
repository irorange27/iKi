import { createLogger } from '@iki/backend/logger';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';
import type { ExecutionPlan } from './execution_plan';
import {
  appendSessionFacts,
  getSessionEvents,
  type NewSessionEvent,
  type StoredSessionEvent,
} from '@iki/backend/db/session_events';

const logger = createLogger({ module: 'session_log' });

export class SessionLogCommitError extends Error {
  constructor(
    readonly unpublishedText: string,
    readonly generatedText = unpublishedText,
    options?: { cause?: unknown }
  ) {
    super('Could not save generated output. The turn was stopped.', options);
    this.name = 'SessionLogCommitError';
  }
}

export class SessionLogWriteError extends Error {
  constructor(
    readonly threadId: string,
    options?: { cause?: unknown }
  ) {
    super('Failed to append turn facts to the session log.', options);
    this.name = 'SessionLogWriteError';
  }
}

/**
 * The Session log's v1 event vocabulary and the turn-fact recorder. Events
 * are business facts about a conversation's turns — what input was accepted,
 * under which plan a turn started, what the model committed, how the turn
 * ended — not SDK stream deltas. UI rows, run audit and working state are
 * rebuildable projections; this stream is the record they must be derivable
 * from (stage C: D21–D23).
 */

export const INPUT_ACCEPTED = 'input_accepted';
export const TURN_STARTED = 'turn_started';
/** One inline tool execution (issue #145): an effect that happened without
 * entering the five-state owner's admission (policy-permitted calls the
 * model loop executes directly). Single fact — the turn owns the execution,
 * no cross-process admission to record. Additive event type: old readers
 * degrade unknown types to no-ops. */
export const TOOL_EXECUTED = 'tool_executed';
/** A steering input the human sent mid-turn (audit H6). The driver splices
 * it into the next prompt; without this fact the log holds only the original
 * INPUT_ACCEPTED, so a recovery replay cannot see that the human ever
 * steered. Additive: old readers degrade unknown types to no-ops. */
export const STEERING_INPUT_ACCEPTED = 'steering_input_accepted';
export const MODEL_TEXT_COMMITTED = 'model_text_committed';
export const MODEL_OUTPUT_COMMITTED = 'model_output_committed';
export const TURN_COMPLETED = 'turn_completed';
export const TURN_FAILED = 'turn_failed';
export const TURN_CANCELLED = 'turn_cancelled';
export const APPROVAL_REQUESTED = 'approval_requested';
export const APPROVAL_DECIDED = 'approval_decided';

/** Payload schema version — bump when a payload's shape changes in a MEANING
 * way: a field reinterpreted, removed, or made required. Additive OPTIONAL
 * fields extend the vocabulary without a bump (old readers ignore unknown
 * payload fields; new readers default absence to the old shape) — issue #139
 * adds `runId`/`system` to input_accepted this way. */
export const SESSION_EVENT_VERSION = 1;

export type InputAcceptedPayload = {
  messageId: string;
  message: ChatUiMessage;
  /** The run the input was accepted for — recorded by id-less wake/task
   * sends (issue #139); the recovery gate joins it against the retried
   * run's ancestry so a later send's task is never re-run under an earlier
   * run's plan. Chat inputs (client message ids) omit it. */
  runId?: string;
  /** The caller's system-message contents, recorded by id-less wake/task
   * sends: the task's agent prompt is execution config the plan never
   * captured (plan.systemPrompt is the template join), and a resume without
   * it would re-run the task under the wrong persona. Chat inputs omit it —
   * their system assembly belongs to the preparer. */
  system?: string[];
};

export type TurnStartedPayload = {
  runId: string;
  kind: string;
  plan: ExecutionPlan;
};

/** A mid-turn steering input (audit H6). `messageId` is the rebuilt user
 * message's id and must differ from the assistant's, or the assistant's
 * MODEL_OUTPUT_COMMITTED fact overwrites this message in the replay. */
export type SteeringInputAcceptedPayload = {
  runId: string;
  messageId: string;
  /** The batch the steer was drained in, so the id is unique per turn. */
  batchIndex: number;
  text: string;
};

export type ModelTextCommittedPayload = {
  runId: string;
  messageId: string;
  /** Within-run counter in commit order — replay concatenates in log order. */
  seq: number;
  text: string;
};

export type ModelOutputCommittedPayload = {
  runId: string;
  messageId: string;
  /** The committed assistant message (partial at an approval pause, final at
   *  completion) — the same facts the UI projection row carries. */
  message: ChatUiMessage;
  transport: string;
};

export type TurnTerminalPayload = {
  runId: string;
  status: AgentRunStatus;
  finishReason?: string;
  errorText?: string;
};

export type ApprovalRequestedPayload = {
  approvalId: string;
  sessionId: string;
  runId?: string;
  toolCallId?: string | null;
  toolName?: string | null;
  args?: Record<string, unknown> | null;
};

export type ApprovalDecidedPayload = {
  approvalId: string;
  approved: boolean;
  reason?: string;
  source: 'user' | 'timeout' | 'system';
};

/** Append observations atomically. Throws SessionLogWriteError on failure:
 * an unrecorded fact must not be indistinguishable from a recorded one
 * (ADR 008), so pre-execution and success-path callers let it fail the turn.
 * A failure-path terminal fact — one reported by a catch/cancel/recovery
 * handler — must not mask the failure it is recording; those call
 * recordFailureTerminalEvent. Any other degradation needs an explicit catch
 * with a stated reason. */
export const recordSessionEvents = (
  threadId: string,
  events: NewSessionEvent[]
): void => {
  if (!threadId || events.length === 0) return;
  try {
    appendSessionFacts(threadId, events);
  } catch (error) {
    throw new SessionLogWriteError(threadId, { cause: error });
  }
};

/** Record a terminal fact on a path that is already reporting a failure
 * (catch-path turn_failed, cancel/lease-loss barriers, approval expiry,
 * startup reclamation). A lost record is logged at error level; it never
 * masks the original failure reaching its subscriber, and it never
 * downgrades the event itself to warn-and-continue. */
export const recordFailureTerminalEvent = (
  threadId: string,
  events: NewSessionEvent[]
): void => {
  try {
    recordSessionEvents(threadId, events);
  } catch (error) {
    logger.event({
      level: 'error',
      event: 'session_log.terminal_fact_lost',
      outcome: 'degraded',
      entity: { thread_id: threadId },
      message:
        'Failed to record a failure-path terminal fact; the original failure is still being reported.',
      error,
    });
  }
};

export type TurnFact = {
  input?: InputAcceptedPayload;
  started?: TurnStartedPayload;
  committed?: ModelOutputCommittedPayload;
  terminal?: TurnTerminalPayload;
};

/** Convenience ordering: input → start → committed output → terminal. */
export const turnFactsToEvents = (facts: TurnFact): NewSessionEvent[] => {
  const events: NewSessionEvent[] = [];
  if (facts.input) events.push({ type: INPUT_ACCEPTED, version: SESSION_EVENT_VERSION, payload: facts.input });
  if (facts.started) events.push({ type: TURN_STARTED, version: SESSION_EVENT_VERSION, payload: facts.started });
  if (facts.committed)
    events.push({ type: MODEL_OUTPUT_COMMITTED, version: SESSION_EVENT_VERSION, payload: facts.committed });
  if (facts.terminal) {
    const type =
      facts.terminal.status === 'completed'
        ? TURN_COMPLETED
        : facts.terminal.status === 'cancelled'
          ? TURN_CANCELLED
          : TURN_FAILED;
    events.push({ type, version: SESSION_EVENT_VERSION, payload: facts.terminal });
  }
  return events;
};

// ── Pure replay ─────────────────────────────────────────────────────────

export type RebuiltTurn = {
  runId: string;
  kind: string;
  status: AgentRunStatus;
  finishReason?: string;
  errorText?: string;
};

export type RebuiltApproval = {
  approvalId: string;
  status: 'pending' | 'approved' | 'rejected';
  sessionId?: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  decisionReason?: string;
  decisionSource?: ApprovalDecidedPayload['source'];
};

export type RebuiltThreadView = {
  messageId: string;
  events: StoredSessionEvent[];
  messages: ChatUiMessage[];
  turns: RebuiltTurn[];
  approvals: RebuiltApproval[];
  /** The system-message contents recorded with the LAST input_accepted fact
   * (issue #139): the system config travels bound to its input fact — a
   * recovery consumer rebuilding a request from the replay pairs the tail
   * input with THESE prompts. Chat inputs carry none, so chat-turn recovery
   * sees an empty array and its preparer-owned assembly is untouched. */
  inputSystemPrompts: string[];
  /** The `runId` of the LAST input_accepted fact, when it carries one
   * (issue #139). The recovery gate joins it against the retried run's
   * ancestry; absent for chat facts and pre-#139 rows, which skip the join. */
  inputRunId?: string;
};

/** Structural guard for message payloads — replay and recording share it. */
export const asChatUiMessage = (value: unknown): ChatUiMessage | null => {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { id?: unknown; role?: unknown; parts?: unknown };
  if (typeof candidate.id !== 'string' || typeof candidate.role !== 'string') return null;
  if (!Array.isArray(candidate.parts)) return null;
  return value as ChatUiMessage;
};

/**
 * Rebuild the conversation view from the event stream alone. Pure: reads
 * rows, applies them in revision order, calls nothing — no model, no tools,
 * no run rights (acceptance item 2). Later slices extend the reducer to the
 * queue/consumption-permit facts; the message + turn reconstruction here is
 * the seed every extension must keep zero-side-effect.
 */
export const rebuildThreadViewFromEvents = (
  threadId: string,
  options?: { excludeRunIds?: string[] }
): RebuiltThreadView => {
  // A retried/resumed turn re-runs the ORIGINAL task from the conversation
  // BEFORE it: the dead attempts' own committed output is excluded so the
  // request ends with the task (prompt derivation) and the retry keeps the
  // old row-copy semantics from the authoritative source. The caller owns
  // the chain semantics (issue #141: the whole dead task chain, not just the
  // retried run — an earlier failure's committed text must not stand between
  // the task and the retry). Facts stay in the log — display and replay
  // still show the whole story.
  const excluded = new Set(options?.excludeRunIds ?? []);
  const events = getSessionEvents(threadId).filter(event => {
    if (excluded.size === 0) return true;
    if (
      event.type !== MODEL_OUTPUT_COMMITTED &&
      event.type !== MODEL_TEXT_COMMITTED
    )
      return true;
    return !excluded.has((event.payload as { runId?: unknown }).runId as string);
  });
  const messages: ChatUiMessage[] = [];
  const turns = new Map<string, RebuiltTurn>();
  const approvals = new Map<string, RebuiltApproval>();
  let inputSystemPrompts: string[] = [];
  let inputRunId: string | undefined;

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    switch (event.type) {
      case INPUT_ACCEPTED:
      case MODEL_OUTPUT_COMMITTED: {
        const message = asChatUiMessage(payload.message);
        if (!message) break;
        const existing = messages.findIndex(item => item.id === message.id);
        if (existing >= 0) messages[existing] = message;
        else messages.push(message);
        if (event.type === INPUT_ACCEPTED) {
          // The system config is bound to its input fact: each new fact
          // REPLACES the binding, so a thread interleaving task and chat
          // sends pairs the tail input with its own config. A malformed
          // array resets to none — never a partial config.
          const system = payload.system;
          inputSystemPrompts =
            Array.isArray(system) && system.every(item => typeof item === 'string' && item.trim())
              ? [...(system as string[])]
              : [];
          inputRunId = typeof payload.runId === 'string' ? payload.runId : undefined;
        }
        break;
      }
      case STEERING_INPUT_ACCEPTED: {
        // A mid-turn steering input becomes a user message in the rebuilt
        // conversation. Without this arm the log carried the fact but no
        // recovery consumer could reconstruct it — the steer existed only in
        // the live turn's streamHistory, so a replay rebuilt a conversation
        // where the human never steered.
        const steerText = typeof payload.text === 'string' ? payload.text : '';
        const steerMessageId =
          typeof payload.messageId === 'string' && payload.messageId
            ? payload.messageId
            : typeof payload.runId === 'string' && payload.runId
              ? `steer_${payload.runId}`
              : '';
        if (!steerMessageId || !steerText.trim()) break;
        const steerMessage = {
          id: steerMessageId,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: `[STEERING INPUT]\n\n${steerText}` }],
        };
        const steerExisting = messages.findIndex(item => item.id === steerMessageId);
        if (steerExisting >= 0) messages[steerExisting] = steerMessage;
        else messages.push(steerMessage);
        break;
      }
      case MODEL_TEXT_COMMITTED: {
        const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
        const text = typeof payload.text === 'string' ? payload.text : '';
        if (!messageId || !text) break;
        let message = messages.find(item => item.id === messageId);
        if (!message) {
          message = { id: messageId, role: 'assistant', parts: [] };
          messages.push(message);
        }
        const parts = message.parts as Array<{ type: string; text?: string }>;
        const lastText = parts[parts.length - 1];
        if (parts.length > 0 && lastText?.type === 'text' && typeof lastText.text === 'string') {
          lastText.text += text;
        } else {
          parts.push({ type: 'text', text });
        }
        break;
      }
      case APPROVAL_REQUESTED: {
        const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : '';
        if (!approvalId) break;
        approvals.set(approvalId, {
          approvalId,
          status: 'pending',
          ...(typeof payload.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
          ...(typeof payload.runId === 'string' ? { runId: payload.runId } : {}),
          ...(typeof payload.toolName === 'string' ? { toolName: payload.toolName } : {}),
          ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
          ...(payload.args && typeof payload.args === 'object'
            ? { args: payload.args as Record<string, unknown> }
            : {}),
        });
        break;
      }
      case APPROVAL_DECIDED: {
        const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : '';
        if (!approvalId) break;
        const approval = approvals.get(approvalId) ?? { approvalId, status: 'pending' as const };
        approvals.set(approvalId, {
          ...approval,
          status: payload.approved === true ? 'approved' : 'rejected',
          ...(typeof payload.reason === 'string' ? { decisionReason: payload.reason } : {}),
          ...(typeof payload.source === 'string'
            ? { decisionSource: payload.source as ApprovalDecidedPayload['source'] }
            : {}),
        });
        break;
      }
      case TURN_STARTED: {
        const runId = typeof payload.runId === 'string' ? payload.runId : '';
        if (!runId) break;
        turns.set(runId, {
          runId,
          kind: typeof payload.kind === 'string' ? payload.kind : 'chat-turn',
          status: 'running',
        });
        break;
      }
      case TURN_COMPLETED:
      case TURN_FAILED:
      case TURN_CANCELLED: {
        const runId = typeof payload.runId === 'string' ? payload.runId : '';
        if (!runId) break;
        const turn = turns.get(runId) ?? { runId, kind: 'chat-turn', status: 'running' as const };
        turns.set(runId, {
          ...turn,
          status:
            event.type === TURN_COMPLETED
              ? 'completed'
              : event.type === TURN_CANCELLED
                ? 'cancelled'
                : 'failed',
          ...(typeof payload.finishReason === 'string' ? { finishReason: payload.finishReason } : {}),
          ...(typeof payload.errorText === 'string' ? { errorText: payload.errorText } : {}),
        });
        break;
      }
      default:
        // Unknown event types are skipped by replay, never interpreted —
        // forward compatibility means new facts degrade to no-ops here.
        break;
    }
  }

  return {
    messageId: `replay:${threadId}`,
    events,
    messages,
    turns: [...turns.values()],
    approvals: [...approvals.values()],
    inputSystemPrompts,
    ...(inputRunId ? { inputRunId } : {}),
  };
};
