/**
 * Event-bus / agent-session event domain contract.
 *
 * Follows pi's `coding-agent/src/core/event-bus.ts` (EventBus /
 * EventBusController) and the `AgentSessionEvent` family re-exported from
 * `coding-agent/src/index.ts` (`core/extensions`). One schema is the single
 * source of truth; the TypeScript types are static projections of it
 * (`z.infer`), and even the callable parts of the bus are declared by the
 * schema (`z.custom<(...args) => ...>()`) instead of hand-written interfaces.
 * A `parse*` entry point validates one untrusted event and hands out the typed
 * projection.
 *
 * iKi persists one event per line in an append-only JSONL session log
 * (`packages/store/src/session_log_store.ts`): those rows are the durable
 * form of these contracts. `SessionEventSchema` is the contract version of a
 * stored row (type + payload + revision), `SessionEventTypeSchema` is the
 * enum of iKi's own event names, and `AgentSessionEventSchema` mirrors pi's
 * live in-process event stream. Parsing through zod makes a corrupt row fail
 * loud instead of quietly becoming "no event".
 *
 * This is a leaf contract layer: it imports nothing but zod and knows nothing
 * about Electron, IPC, the store, or the session-log reducer. Rich pi payloads
 * (AgentMessage, Model, CompactionEntry, tool args/results, streaming events)
 * are projected as JSON envelopes here; their concrete shapes belong to the
 * runtime layer, not to this file.
 */
import { z } from 'zod';

// ============================================================================
// Foundations (kept local so this file imports nothing but zod)
// ============================================================================

/** Recursive JSON value, as a schema so derived types keep their shape. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/** An opaque pi object (AgentMessage / Model / CompactionEntry / stream event). */
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

/** A callable field: declared by the schema and validated as a function at runtime. */
const callable = <T>() => z.custom<T>((value) => typeof value === 'function');

// ============================================================================
// Event bus (pi `core/event-bus`)
// ============================================================================

/** pi's `EventBus`: publish on a channel, subscribe, get an unsubscribe. */
export const EventBusSchema = z.object({
  emit: callable<(channel: string, data: unknown) => void>(),
  on: callable<(channel: string, handler: (data: unknown) => void) => () => void>(),
});
export type EventBus = z.infer<typeof EventBusSchema>;

/** pi's `EventBusController`: an EventBus that can also drop every listener. */
export const EventBusControllerSchema = EventBusSchema.extend({
  clear: callable<() => void>(),
});
export type EventBusController = z.infer<typeof EventBusControllerSchema>;

// ============================================================================
// Agent session events (pi `core/extensions` — discriminant: `type`)
// ============================================================================

export const AgentStartEventSchema = z.object({ type: z.literal('agent_start') });
export type AgentStartEvent = z.infer<typeof AgentStartEventSchema>;

export const AgentEndEventSchema = z.object({
  type: z.literal('agent_end'),
  messages: z.array(JsonObjectSchema),
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
  message: JsonObjectSchema,
  toolResults: z.array(JsonObjectSchema),
  messageEntryId: z.string(),
  toolResultEntryIds: z.array(z.string()),
});
export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;

export const MessageStartEventSchema = z.object({
  type: z.literal('message_start'),
  message: JsonObjectSchema,
});
export type MessageStartEvent = z.infer<typeof MessageStartEventSchema>;

export const MessageUpdateEventSchema = z.object({
  type: z.literal('message_update'),
  message: JsonObjectSchema,
  assistantMessageEvent: JsonObjectSchema,
});
export type MessageUpdateEvent = z.infer<typeof MessageUpdateEventSchema>;

export const MessageEndEventSchema = z.object({
  type: z.literal('message_end'),
  message: JsonObjectSchema,
});
export type MessageEndEvent = z.infer<typeof MessageEndEventSchema>;

export const ToolExecutionStartEventSchema = z.object({
  type: z.literal('tool_execution_start'),
  toolCallId: z.string(),
  toolName: z.string(),
  args: JsonValueSchema,
  parentToolCallId: z.string().optional(),
});
export type ToolExecutionStartEvent = z.infer<typeof ToolExecutionStartEventSchema>;

export const ToolExecutionUpdateEventSchema = z.object({
  type: z.literal('tool_execution_update'),
  toolCallId: z.string(),
  toolName: z.string(),
  args: JsonValueSchema,
  partialResult: JsonValueSchema,
  parentToolCallId: z.string().optional(),
});
export type ToolExecutionUpdateEvent = z.infer<typeof ToolExecutionUpdateEventSchema>;

export const ToolExecutionEndEventSchema = z.object({
  type: z.literal('tool_execution_end'),
  toolCallId: z.string(),
  toolName: z.string(),
  result: JsonValueSchema,
  isError: z.boolean(),
  durationMs: z.number().optional(),
  parentToolCallId: z.string().optional(),
});
export type ToolExecutionEndEvent = z.infer<typeof ToolExecutionEndEventSchema>;

export const SessionStartEventSchema = z.object({
  type: z.literal('session_start'),
  reason: z.enum(['startup', 'reload', 'new', 'resume', 'fork']),
  previousSessionFile: z.string().optional(),
});
export type SessionStartEvent = z.infer<typeof SessionStartEventSchema>;

export const SessionCompactEventSchema = z.object({
  type: z.literal('session_compact'),
  compactionEntry: JsonObjectSchema,
  fromExtension: z.boolean(),
  reason: z.enum(['manual', 'threshold', 'overflow']),
  willRetry: z.boolean(),
});
export type SessionCompactEvent = z.infer<typeof SessionCompactEventSchema>;

export const ModelSelectEventSchema = z.object({
  type: z.literal('model_select'),
  model: JsonObjectSchema,
  previousModel: JsonObjectSchema.optional(),
  source: z.enum(['set', 'cycle', 'restore']),
});
export type ModelSelectEvent = z.infer<typeof ModelSelectEventSchema>;

/** pi's `ThinkingLevel` ("off" | "minimal" | ... | "max"). */
export const ThinkingLevelSchema = z.enum([
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const ThinkingLevelSelectEventSchema = z.object({
  type: z.literal('thinking_level_select'),
  level: ThinkingLevelSchema,
  previousLevel: ThinkingLevelSchema,
});
export type ThinkingLevelSelectEvent = z.infer<typeof ThinkingLevelSelectEventSchema>;

/** pi's `AgentSessionEvent`, as a zod discriminated union on `type`. */
export const AgentSessionEventSchema = z.discriminatedUnion('type', [
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
  SessionStartEventSchema,
  SessionCompactEventSchema,
  ModelSelectEventSchema,
  ThinkingLevelSelectEventSchema,
]);
export type AgentSessionEvent = z.infer<typeof AgentSessionEventSchema>;

// ============================================================================
// iKi persisted session events (append-only JSONL)
// ============================================================================

/**
 * The iKi event-name vocabulary, declared exactly once. `core/types/session_events.ts`
 * re-exports these names for the historical import paths, and the enum below is
 * derived from the same map — schema and constants cannot drift apart. Adding a
 * name here means the session log reducer must handle it (ADR-008).
 */
export const SESSION_EVENT_TYPES = {
  INPUT_ACCEPTED: 'input_accepted',
  TURN_STARTED: 'turn_started',
  TOOL_EXECUTED: 'tool_executed',
  STEERING_INPUT_ACCEPTED: 'steering_input_accepted',
  MODEL_TEXT_COMMITTED: 'model_text_committed',
  MODEL_OUTPUT_COMMITTED: 'model_output_committed',
  TURN_COMPLETED: 'turn_completed',
  TURN_FAILED: 'turn_failed',
  TURN_CANCELLED: 'turn_cancelled',
  APPROVAL_REQUESTED: 'approval_requested',
  APPROVAL_DECIDED: 'approval_decided',
  MESSAGES_TRUNCATED: 'messages_truncated',
  TOOL_EXECUTION_PREPARED: 'tool_execution_prepared',
  TOOL_EXECUTION_STARTED: 'tool_execution_started',
  TOOL_EXECUTION_FINISHED: 'tool_execution_finished',
} as const;

type SessionEventName = (typeof SESSION_EVENT_TYPES)[keyof typeof SESSION_EVENT_TYPES];

export const SessionEventTypeSchema = z.enum(
  Object.values(SESSION_EVENT_TYPES) as [SessionEventName, ...SessionEventName[]]
);
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>;

/** Events appended by this build of the app. */
export const SESSION_EVENT_VERSION = 1;

/** The events that carry a whole message in the payload's `messageId` field. */
export const MESSAGE_EVENT_TYPES = [
  SESSION_EVENT_TYPES.INPUT_ACCEPTED,
  SESSION_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
] as const;

/**
 * One JSONL row as a domain contract. The store also stamps `version` and
 * `createdAt`; `type` + `payload` + `revision` are the fields the reducer and
 * every reader agree on.
 */
export const SessionEventSchema = z.object({
  type: SessionEventTypeSchema,
  payload: JsonValueSchema,
  revision: z.number().int().nonnegative(),
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

// ============================================================================
// Runtime validation entry points — these contracts are usable, not just names
// ============================================================================

export const parseSessionEvent = (raw: unknown): SessionEvent =>
  SessionEventSchema.parse(raw);

export const parseAgentSessionEvent = (raw: unknown): AgentSessionEvent =>
  AgentSessionEventSchema.parse(raw);
