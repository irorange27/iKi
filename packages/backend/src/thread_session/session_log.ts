import { createLogger } from '@iki/backend/logger';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';
import type { ExecutionPlan } from './execution_plan';
import {
  appendSessionEvents,
  getSessionEventRevision,
  getSessionEvents,
  type NewSessionEvent,
  type StoredSessionEvent,
} from '@iki/backend/db/session_events';

const logger = createLogger({ module: 'session_log' });

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
export const MODEL_OUTPUT_COMMITTED = 'model_output_committed';
export const TURN_COMPLETED = 'turn_completed';
export const TURN_FAILED = 'turn_failed';
export const TURN_CANCELLED = 'turn_cancelled';

/** Payload schema version — bump when a payload's shape changes. */
export const SESSION_EVENT_VERSION = 1;

export type InputAcceptedPayload = {
  messageId: string;
  message: ChatUiMessage;
};

export type TurnStartedPayload = {
  runId: string;
  kind: string;
  plan: ExecutionPlan;
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

const isTerminalEvent = (type: string): boolean =>
  type === TURN_COMPLETED || type === TURN_FAILED || type === TURN_CANCELLED;

/**
 * Append turn facts to a thread's stream. Migration-period behavior: a
 * failing append degrades to a warning and never fails the turn — the legacy
 * tables are still the serving authority until the log takes over. The
 * caller passes the stream revision it observed; the helper re-reads it at
 * write time (turn recording is a single writer per turn in practice; a
 * lost race only costs these appended facts, which the warn surfaces).
 */
export const recordTurnEvents = (
  threadId: string,
  events: NewSessionEvent[]
): void => {
  if (!threadId || events.length === 0) return;
  try {
    const revision = appendSessionEvents(
      threadId,
      getSessionEventRevision(threadId),
      events
    );
    if (revision === null) {
      logger.event({
        level: 'warn',
        event: 'session_log.append',
        outcome: 'degraded',
        entity: { thread_id: threadId },
        message: 'Session log append lost the revision race; turn facts were not recorded.',
        data: { event_types: events.map(event => event.type) },
      });
    }
  } catch (error) {
    logger.event({
      level: 'warn',
      event: 'session_log.append',
      outcome: 'degraded',
      entity: { thread_id: threadId },
      message: 'Failed to append turn facts to the session log.',
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

export type RebuiltThreadView = {
  messageId: string;
  events: StoredSessionEvent[];
  messages: ChatUiMessage[];
  turns: RebuiltTurn[];
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
export const rebuildThreadViewFromEvents = (threadId: string): RebuiltThreadView => {
  const events = getSessionEvents(threadId);
  const messages: ChatUiMessage[] = [];
  const turns = new Map<string, RebuiltTurn>();

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
          status: isTerminalEvent(event.type)
            ? (event.type === TURN_COMPLETED
              ? 'completed'
              : event.type === TURN_CANCELLED
                ? 'cancelled'
                : 'failed')
            : turn.status,
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
  };
};
