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
export const MODEL_TEXT_COMMITTED = 'model_text_committed';
export const MODEL_OUTPUT_COMMITTED = 'model_output_committed';
export const TURN_COMPLETED = 'turn_completed';
export const TURN_FAILED = 'turn_failed';
export const TURN_CANCELLED = 'turn_cancelled';
export const APPROVAL_REQUESTED = 'approval_requested';
export const APPROVAL_DECIDED = 'approval_decided';

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

/**
 * Append facts to a thread's stream. Migration-period behavior: a
 * failing append degrades to a warning and never fails the turn — the legacy
 * tables are still the serving authority until the log takes over. The
 * helper re-reads the stream head at write time (turn recording is a single
 * writer per turn in practice; a lost race only costs these appended facts,
 * which the warn surfaces).
 */
export const recordSessionEvents = (
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
  const approvals = new Map<string, RebuiltApproval>();

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
  };
};
