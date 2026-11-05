/**
 * Event domain contract.
 *
 * Follows pi's `coding-agent/src/core/event-bus.ts`,
 * `core/extensions/types.ts` (AgentEvent family) and
 * `core/agent-session.ts` (`AgentSessionEvent` union). One schema is the single
 * source of truth; TypeScript types are its static projection (`z.infer`).
 *
 * iKi persists session events as append-only JSONL batches. `StoredSessionEvent`
 * / `NewSessionEvent` below are that on-disk contract — copied from the store's
 * real shape, not from a UI view. Provider-owned payloads (AgentMessage,
 * AssistantMessageEvent, ToolResultMessage, SessionEntry) stay opaque: this is a
 * leaf contract layer and imports nothing but zod.
 */
import { z } from 'zod';

/* ---- Event bus (pi `core/event-bus.ts`) ---- */

export const EventBusSchema = z.object({
  emit: z.custom<(channel: string, data: unknown) => void>(),
  on: z.custom<(channel: string, handler: (data: unknown) => void) => () => void>(),
});
export type EventBus = z.infer<typeof EventBusSchema>;

export const EventBusControllerSchema = EventBusSchema.extend({
  clear: z.custom<() => void>(),
});
export type EventBusController = z.infer<typeof EventBusControllerSchema>;

/* ---- Core agent events (pi `core/extensions/types.ts`) ---- */

export const AgentStartEventSchema = z.object({ type: z.literal('agent_start') });
export type AgentStartEvent = z.infer<typeof AgentStartEventSchema>;

export const AgentEndEventSchema = z.object({
  type: z.literal('agent_end'),
  messages: z.array(z.unknown()),
});
export type AgentEndEvent = z.infer<typeof AgentEndEventSchema>;

export const TurnStartEventSchema = z.object({
  type: z.literal('turn_start'),
  turnIndex: z.number(),
  timestamp: z.number(),
});
export type TurnStartEvent = z.infer<typeof TurnStartEventSchema>;

export const TurnEndEventSchema = z.object({
  type: z.literal('turn_end'),
  turnIndex: z.number(),
  message: z.unknown(),
  toolResults: z.array(z.unknown()),
  messageEntryId: z.string(),
  toolResultEntryIds: z.array(z.string()),
});
export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;

export const MessageStartEventSchema = z.object({
  type: z.literal('message_start'),
  message: z.unknown(),
});
export type MessageStartEvent = z.infer<typeof MessageStartEventSchema>;

export const MessageUpdateEventSchema = z.object({
  type: z.literal('message_update'),
  message: z.unknown(),
  assistantMessageEvent: z.unknown(),
});
export type MessageUpdateEvent = z.infer<typeof MessageUpdateEventSchema>;

export const MessageEndEventSchema = z.object({
  type: z.literal('message_end'),
  message: z.unknown(),
});
export type MessageEndEvent = z.infer<typeof MessageEndEventSchema>;

const ToolExecutionBaseSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  parentToolCallId: z.string().optional(),
});

export const ToolExecutionStartEventSchema = ToolExecutionBaseSchema.extend({
  type: z.literal('tool_execution_start'),
});
export type ToolExecutionStartEvent = z.infer<typeof ToolExecutionStartEventSchema>;

export const ToolExecutionUpdateEventSchema = ToolExecutionBaseSchema.extend({
  type: z.literal('tool_execution_update'),
  partialResult: z.unknown(),
});
export type ToolExecutionUpdateEvent = z.infer<typeof ToolExecutionUpdateEventSchema>;

export const ToolExecutionEndEventSchema = z.object({
  type: z.literal('tool_execution_end'),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
  isError: z.boolean(),
  durationMs: z.number().optional(),
  parentToolCallId: z.string().optional(),
});
export type ToolExecutionEndEvent = z.infer<typeof ToolExecutionEndEventSchema>;

export const AgentEventSchema = z.discriminatedUnion('type', [
  AgentStartEventSchema,
  AgentEndEventSchema,
  TurnStartEventSchema,
  TurnEndEventSchema,
  MessageStartEventSchema,
  MessageUpdateEventSchema,
  MessageEndEventSchema,
  ToolExecutionStartEventSchema,
  ToolExecutionUpdateEventSchema,
  ToolExecutionEndEventSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/* ---- Session-specific events (pi `core/agent-session.ts`) ---- */

const CompactionReasonSchema = z.enum(['manual', 'threshold', 'overflow']);

export const AgentSettledEventSchema = z.object({
  type: z.literal('agent_settled'),
  aborted: z.boolean(),
});
export const QueueUpdateEventSchema = z.object({
  type: z.literal('queue_update'),
  steering: z.array(z.string()),
  followUp: z.array(z.string()),
});
export const CompactionStartEventSchema = z.object({
  type: z.literal('compaction_start'),
  reason: CompactionReasonSchema,
});
export const EntryAppendedEventSchema = z.object({
  type: z.literal('entry_appended'),
  entry: z.unknown(),
});
export const SessionInfoChangedEventSchema = z.object({
  type: z.literal('session_info_changed'),
  name: z.string().optional(),
});
export const ThinkingLevelChangedEventSchema = z.object({
  type: z.literal('thinking_level_changed'),
  level: z.string(),
});
export const CompactionEndEventSchema = z.object({
  type: z.literal('compaction_end'),
  reason: CompactionReasonSchema,
  result: z.unknown().optional(),
  aborted: z.boolean(),
  willRetry: z.boolean(),
  errorMessage: z.string().optional(),
});
export const AutoRetryStartEventSchema = z.object({
  type: z.literal('auto_retry_start'),
  attempt: z.number(),
  maxAttempts: z.number(),
  delayMs: z.number(),
  errorMessage: z.string(),
});
export const AutoRetryEndEventSchema = z.object({
  type: z.literal('auto_retry_end'),
  success: z.boolean(),
  attempt: z.number(),
  finalError: z.string().optional(),
});
export const SummarizationRetryScheduledEventSchema = z.object({
  type: z.literal('summarization_retry_scheduled'),
  attempt: z.number(),
  maxAttempts: z.number(),
  delayMs: z.number(),
  errorMessage: z.string(),
});
export const SummarizationRetryAttemptStartEventSchema = z.object({
  type: z.literal('summarization_retry_attempt_start'),
  source: z.enum(['branchSummary', 'compaction']),
  reason: CompactionReasonSchema.optional(),
});
export const SummarizationRetryFinishedEventSchema = z.object({
  type: z.literal('summarization_retry_finished'),
});
export const BashExecutionUpdateEventSchema = z.object({
  type: z.literal('bash_execution_update'),
  id: z.string().optional(),
  delta: z.string(),
});

/** The full union: core agent events (with optional parent tool call id) plus session events. */
export const AgentSessionEventSchema = z.discriminatedUnion('type', [
  AgentStartEventSchema,
  AgentEndEventSchema.extend({ willRetry: z.boolean() }),
  TurnStartEventSchema,
  TurnEndEventSchema,
  MessageStartEventSchema,
  MessageUpdateEventSchema,
  MessageEndEventSchema,
  ToolExecutionStartEventSchema.extend({ parentToolCallId: z.string().optional() }),
  ToolExecutionUpdateEventSchema.extend({ parentToolCallId: z.string().optional() }),
  ToolExecutionEndEventSchema.extend({ parentToolCallId: z.string().optional() }),
  AgentSettledEventSchema,
  QueueUpdateEventSchema,
  CompactionStartEventSchema,
  EntryAppendedEventSchema,
  SessionInfoChangedEventSchema,
  ThinkingLevelChangedEventSchema,
  CompactionEndEventSchema,
  AutoRetryStartEventSchema,
  AutoRetryEndEventSchema,
  SummarizationRetryScheduledEventSchema,
  SummarizationRetryAttemptStartEventSchema,
  SummarizationRetryFinishedEventSchema,
  BashExecutionUpdateEventSchema,
]);
export type AgentSessionEvent = z.infer<typeof AgentSessionEventSchema>;

/* ---- iKi persisted session events (append-only JSONL) ---- */

export const SessionEventTypeSchema = z.enum([
  'input_accepted',
  'turn_started',
  'tool_executed',
  'steering_input_accepted',
  'model_text_committed',
  'model_output_committed',
  'turn_completed',
  'turn_failed',
  'turn_cancelled',
  'approval_requested',
  'approval_decided',
  'messages_truncated',
  'tool_execution_prepared',
  'tool_execution_started',
  'tool_execution_finished',
]);
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>;

export const SESSION_EVENT_VERSION = 1;

/** One event as stored in a JSONL batch line. */
export const NewSessionEventSchema = z.object({
  type: z.string(),
  version: z.number(),
  payload: z.unknown(),
});
export type NewSessionEvent = z.infer<typeof NewSessionEventSchema>;

/** One event as replayed from the log. */
export const StoredSessionEventSchema = NewSessionEventSchema.extend({
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type StoredSessionEvent = z.infer<typeof StoredSessionEventSchema>;

/** Events that carry a whole message in `payload.messageId`. */
export const MESSAGE_EVENT_TYPES = [
  'input_accepted',
  'model_output_committed',
] as const satisfies readonly SessionEventType[];

/** Runtime entry points: replayed rows / bus messages must satisfy the contract. */
export const parseStoredSessionEvent = (raw: unknown): StoredSessionEvent =>
  StoredSessionEventSchema.parse(raw);
export const parseNewSessionEvent = (raw: unknown): NewSessionEvent =>
  NewSessionEventSchema.parse(raw);
export const parseAgentSessionEvent = (raw: unknown): AgentSessionEvent =>
  AgentSessionEventSchema.parse(raw);
