/**
 * The session-event vocabulary lives in the domain contract
 * (`../domain/events` — `SESSION_EVENT_TYPES` is declared there exactly once,
 * and the zod enum is derived from the same map). This module re-exports the
 * names under their historical import path so the store module, the session
 * log and turn_prep's persistence port never re-declare the vocabulary.
 *
 * Adding a name means the session log must handle it in
 * `rebuildThreadViewFromEvents`; the log is the authority on what a thread is
 * (ADR-008), so the vocabulary and its reducer belong to the same change.
 */
import { SESSION_EVENT_TYPES } from '../domain/events';

export const INPUT_ACCEPTED = SESSION_EVENT_TYPES.INPUT_ACCEPTED;
export const TURN_STARTED = SESSION_EVENT_TYPES.TURN_STARTED;
export const TOOL_EXECUTED = SESSION_EVENT_TYPES.TOOL_EXECUTED;
export const STEERING_INPUT_ACCEPTED = SESSION_EVENT_TYPES.STEERING_INPUT_ACCEPTED;
export const MODEL_TEXT_COMMITTED = SESSION_EVENT_TYPES.MODEL_TEXT_COMMITTED;
export const MODEL_OUTPUT_COMMITTED = SESSION_EVENT_TYPES.MODEL_OUTPUT_COMMITTED;
export const TURN_COMPLETED = SESSION_EVENT_TYPES.TURN_COMPLETED;
export const TURN_FAILED = SESSION_EVENT_TYPES.TURN_FAILED;
export const TURN_CANCELLED = SESSION_EVENT_TYPES.TURN_CANCELLED;
export const APPROVAL_REQUESTED = SESSION_EVENT_TYPES.APPROVAL_REQUESTED;
export const APPROVAL_DECIDED = SESSION_EVENT_TYPES.APPROVAL_DECIDED;
export const MESSAGES_TRUNCATED = SESSION_EVENT_TYPES.MESSAGES_TRUNCATED;
export const TOOL_EXECUTION_PREPARED = SESSION_EVENT_TYPES.TOOL_EXECUTION_PREPARED;
export const TOOL_EXECUTION_STARTED = SESSION_EVENT_TYPES.TOOL_EXECUTION_STARTED;
export const TOOL_EXECUTION_FINISHED = SESSION_EVENT_TYPES.TOOL_EXECUTION_FINISHED;

export { SESSION_EVENT_VERSION, MESSAGE_EVENT_TYPES } from '../domain/events';
export type { SessionEventType } from '../domain/events';
