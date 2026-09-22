import type { DynamicToolPart } from '../message_parts';
import { isObjectRecord } from '../message_parts';

// A persisted tool part can be left non-terminal by a crash, quit, or a
// restart-killed run. Converting it to a recorded error keeps three consumers
// aligned: the UI renders a terminal state, providers receive a paired error
// tool result on the next turn, and the approval card stops being answerable.
export const TOOL_INTERRUPTED_ERROR_TEXT =
  'Tool execution was interrupted before a result was recorded (turn ended or app restarted); the action may or may not have taken effect. Verify the current state before retrying.';

export const APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT =
  'Tool call was waiting for approval when the app restarted; it never executed. Re-issue the request if you still want it.';

const TERMINAL_DYNAMIC_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied']);

export const isTerminalDynamicToolPart = (part: unknown): boolean =>
  isObjectRecord(part) &&
  typeof part.state === 'string' &&
  TERMINAL_DYNAMIC_TOOL_STATES.has(part.state);

export const toInterruptedToolPart = (
  part: DynamicToolPart,
  errorText: string = TOOL_INTERRUPTED_ERROR_TEXT
): DynamicToolPart => ({
  type: 'dynamic-tool',
  toolCallId: part.toolCallId,
  toolName: part.toolName,
  ...(part.title !== undefined ? { title: part.title } : {}),
  ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
  state: 'output-error',
  input: part.input ?? {},
  errorText,
});

// State-aware text for persisted-part marking at restart: an approval-gated
// call certainly never ran; anything interrupted mid-flight may have.
export const interruptedToolPartErrorText = (part: DynamicToolPart): string =>
  part.state === 'approval-requested' || part.state === 'approval-responded'
    ? APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT
    : TOOL_INTERRUPTED_ERROR_TEXT;
