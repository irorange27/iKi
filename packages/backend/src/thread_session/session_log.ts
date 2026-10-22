import { createLogger } from '@iki/backend/logger';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';
import type { ExecutionPlan } from './execution_plan';
import { parseExecutionPlanValue } from './execution_plan_codec';
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

export const INPUT_ACCEPTED = 'input_accepted';
export const TURN_STARTED = 'turn_started';

export const TOOL_EXECUTED = 'tool_executed';

export const STEERING_INPUT_ACCEPTED = 'steering_input_accepted';
export const MODEL_TEXT_COMMITTED = 'model_text_committed';
export const MODEL_OUTPUT_COMMITTED = 'model_output_committed';
const TURN_COMPLETED = 'turn_completed';
const TURN_FAILED = 'turn_failed';
const TURN_CANCELLED = 'turn_cancelled';
export const APPROVAL_REQUESTED = 'approval_requested';
export const APPROVAL_DECIDED = 'approval_decided';

export const MESSAGES_TRUNCATED = 'messages_truncated';

export const SESSION_EVENT_VERSION = 1;

export type InputAcceptedPayload = {
  messageId: string;
  message: ChatUiMessage;

  runId?: string;

  system?: string[];
};

export type TurnStartedPayload = {
  runId: string;
  kind: string;
  plan: ExecutionPlan;
};

export type SteeringInputAcceptedPayload = {
  runId: string;
  messageId: string;

  batchIndex: number;
  text: string;
};

export type ModelOutputCommittedPayload = {
  runId: string;
  messageId: string;

  message: ChatUiMessage;
  transport: string;
};

export type TurnTerminalPayload = {
  runId: string;
  status: AgentRunStatus;
  finishReason?: string;
  errorText?: string;
};

export type ApprovalDecidedPayload = {
  approvalId: string;
  approved: boolean;
  reason?: string;
  source: 'user' | 'timeout' | 'system';
};

export type MessagesTruncatedPayload = {

  afterMessageId: string;
  deletedMessageIds: string[];
  truncatedAt: string;
};

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

export type RebuiltTurn = {
  runId: string;
  kind: string;
  status: AgentRunStatus;
  finishReason?: string;
  errorText?: string;

  plan?: ExecutionPlan;
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

  inputSystemPrompts: string[];

  inputRunId?: string;
};

export const asChatUiMessage = (value: unknown): ChatUiMessage | null => {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { id?: unknown; role?: unknown; parts?: unknown };
  if (typeof candidate.id !== 'string' || typeof candidate.role !== 'string') return null;
  if (!Array.isArray(candidate.parts)) return null;
  return value as ChatUiMessage;
};

export const rebuildThreadViewFromEvents = (
  threadId: string,
  options?: { excludeRunIds?: string[] }
): RebuiltThreadView => {

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

  const inputBindings: { messageId: string; system: string[]; runId?: string }[] = [];

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

          const system = payload.system;
          inputSystemPrompts =
            Array.isArray(system) && system.every(item => typeof item === 'string' && item.trim())
              ? [...(system as string[])]
              : [];
          inputRunId = typeof payload.runId === 'string' ? payload.runId : undefined;
          inputBindings.push({
            messageId: message.id,
            system: inputSystemPrompts,
            ...(inputRunId ? { runId: inputRunId } : {}),
          });
        }
        break;
      }
      case STEERING_INPUT_ACCEPTED: {

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
      case MESSAGES_TRUNCATED: {

        const deletedIds = Array.isArray(payload.deletedMessageIds)
          ? payload.deletedMessageIds.filter((id): id is string => typeof id === 'string')
          : [];
        if (deletedIds.length === 0) break;
        const deleted = new Set(deletedIds);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (deleted.has(messages[index]?.id ?? '')) messages.splice(index, 1);
        }

        for (let index = inputBindings.length - 1; index >= 0; index -= 1) {
          if (deleted.has(inputBindings[index]?.messageId ?? '')) inputBindings.splice(index, 1);
        }
        const tail = inputBindings[inputBindings.length - 1];
        inputSystemPrompts = tail ? [...tail.system] : [];
        inputRunId = tail?.runId;
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

        const plan = parseExecutionPlanValue(payload.plan);
        turns.set(runId, {
          runId,
          kind: typeof payload.kind === 'string' ? payload.kind : 'chat-turn',
          status: 'running',
          ...(plan ? { plan } : {}),
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
