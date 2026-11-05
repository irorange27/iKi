/**
 * Event domain contract.
 *
 * Mirrors pi's `coding-agent/src/core/event-bus.ts` and the `AgentSessionEvent`
 * family exported from `coding-agent/src/index.ts`. One schema is the single
 * source of truth; TypeScript types are its static projection (`z.infer`).
 * iKi persists session events as append-only JSONL rows — the entries below
 * are the contract for those rows, not a projection of a UI state store.
 */
import { z } from 'zod';

/* ---- Event bus (pi `core/event-bus`) ---- */

export const EventBusSchema = z.object({
  emit: z.custom<(type: string, payload: unknown) => void>(),
  on: z.custom<(type: string, handler: (payload: unknown) => void) => () => void>(),
});
export type EventBus = z.infer<typeof EventBusSchema>;

export const EventBusControllerSchema = EventBusSchema.extend({
  clear: z.custom<() => void>().optional(),
  listenerCount: z.custom<(type: string) => number>().optional(),
});
export type EventBusController = z.infer<typeof EventBusControllerSchema>;

/* ---- Agent session events (pi `core/extensions` event family) ---- */

const BaseEventSchema = z.object({ timestamp: z.string().optional() });

export const AgentStartEventSchema = BaseEventSchema.extend({ type: z.literal('agent_start') });
export const AgentEndEventSchema = BaseEventSchema.extend({ type: z.literal('agent_end') });
export const TurnStartEventSchema = BaseEventSchema.extend({ type: z.literal('turn_start') });
export const TurnEndEventSchema = BaseEventSchema.extend({
  type: z.literal('turn_end'),
  stopReason: z.string().optional(),
});
export const MessageStartEventSchema = BaseEventSchema.extend({
  type: z.literal('message_start'),
  messageId: z.string(),
});
export const MessageUpdateEventSchema = BaseEventSchema.extend({
  type: z.literal('message_update'),
  messageId: z.string(),
  delta: z.unknown(),
});
export const MessageEndEventSchema = BaseEventSchema.extend({
  type: z.literal('message_end'),
  messageId: z.string(),
});
export const ToolExecutionStartEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_execution_start'),
  toolCallId: z.string(),
  toolName: z.string(),
});
export const ToolExecutionUpdateEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_execution_update'),
  toolCallId: z.string(),
  delta: z.unknown(),
});
export const ToolExecutionEndEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_execution_end'),
  toolCallId: z.string(),
  isError: z.boolean().optional(),
});
export const SessionStartEventSchema = BaseEventSchema.extend({ type: z.literal('session_start') });
export const SessionCompactEventSchema = BaseEventSchema.extend({
  type: z.literal('session_compact'),
  summary: z.string().optional(),
});
export const ModelSelectEventSchema = BaseEventSchema.extend({
  type: z.literal('model_select'),
  provider: z.string(),
  modelId: z.string(),
});
export const ThinkingLevelSelectEventSchema = BaseEventSchema.extend({
  type: z.literal('thinking_level_select'),
  level: z.string(),
});

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

export type AgentStartEvent = z.infer<typeof AgentStartEventSchema>;
export type AgentEndEvent = z.infer<typeof AgentEndEventSchema>;
export type TurnStartEvent = z.infer<typeof TurnStartEventSchema>;
export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;
export type MessageStartEvent = z.infer<typeof MessageStartEventSchema>;
export type MessageUpdateEvent = z.infer<typeof MessageUpdateEventSchema>;
export type MessageEndEvent = z.infer<typeof MessageEndEventSchema>;
export type ToolExecutionStartEvent = z.infer<typeof ToolExecutionStartEventSchema>;
export type ToolExecutionUpdateEvent = z.infer<typeof ToolExecutionUpdateEventSchema>;
export type ToolExecutionEndEvent = z.infer<typeof ToolExecutionEndEventSchema>;
export type SessionStartEvent = z.infer<typeof SessionStartEventSchema>;
export type SessionCompactEvent = z.infer<typeof SessionCompactEventSchema>;
export type ModelSelectEvent = z.infer<typeof ModelSelectEventSchema>;
export type ThinkingLevelSelectEvent = z.infer<typeof ThinkingLevelSelectEventSchema>;

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

export const SessionEventSchema = z.object({
  type: SessionEventTypeSchema,
  payload: z.unknown(),
  revision: z.number().int().nonnegative(),
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

/** Events that carry a whole message in `payload.messageId`. */
export const MESSAGE_EVENT_TYPES = [
  'input_accepted',
  'model_output_committed',
] as const satisfies readonly SessionEventType[];

/** Runtime entry points: replayed rows / bus messages must satisfy the contract. */
export const parseSessionEvent = (raw: unknown): SessionEvent => SessionEventSchema.parse(raw);
export const parseAgentSessionEvent = (raw: unknown): AgentSessionEvent =>
  AgentSessionEventSchema.parse(raw);
