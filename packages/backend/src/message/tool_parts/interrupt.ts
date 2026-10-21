import type { DynamicToolPart } from '../message_parts';
import { isObjectRecord } from '../message_parts';

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

export const interruptedToolPartErrorText = (part: DynamicToolPart): string =>
  part.state === 'approval-requested' || part.state === 'approval-responded'
    ? APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT
    : TOOL_INTERRUPTED_ERROR_TEXT;
