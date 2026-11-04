/**
 * The session-event vocabulary — one owner for the names stamped into the
 * `session_events` table and matched back out of it.
 *
 * It lives under types/ because all three users of these names sit in different
 * layers and none of them may reach upward: the DB module that stores the rows,
 * the session log that appends and rebuilds from them, and turn_prep's persistence
 * port, which the dependency rules keep away from thread_session/ (R5).
 *
 * Adding a name here means the session log must handle it in
 * `rebuildThreadViewFromEvents`; the log is the authority on what a thread is
 * (ADR-008), so the vocabulary and its reducer belong to the same change.
 */
export const INPUT_ACCEPTED = 'input_accepted';
export const TURN_STARTED = 'turn_started';
export const TOOL_EXECUTED = 'tool_executed';
export const STEERING_INPUT_ACCEPTED = 'steering_input_accepted';
export const MODEL_TEXT_COMMITTED = 'model_text_committed';
export const MODEL_OUTPUT_COMMITTED = 'model_output_committed';
export const TURN_COMPLETED = 'turn_completed';
export const TURN_FAILED = 'turn_failed';
export const TURN_CANCELLED = 'turn_cancelled';
export const APPROVAL_REQUESTED = 'approval_requested';
export const APPROVAL_DECIDED = 'approval_decided';
export const MESSAGES_TRUNCATED = 'messages_truncated';
export const TOOL_EXECUTION_PREPARED = 'tool_execution_prepared';
export const TOOL_EXECUTION_STARTED = 'tool_execution_started';
export const TOOL_EXECUTION_FINISHED = 'tool_execution_finished';

/** Events appended by this build of the app. */
export const SESSION_EVENT_VERSION = 1;

/** The events that carry a whole message, in the payload's `messageId` field. */
export const MESSAGE_EVENT_TYPES = [INPUT_ACCEPTED, MODEL_OUTPUT_COMMITTED] as const;
