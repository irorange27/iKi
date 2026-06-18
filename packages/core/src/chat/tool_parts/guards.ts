import type { ToolPart } from '../message_parts';
import { isObjectRecord } from '../message_parts';
import { getApprovalId } from './ids';

const TOOL_PART_TYPES = new Set([
  'dynamic-tool',
  'tool-call',
  'tool-result',
  'tool-approval-request',
  'tool-approval-response',
]);

export const isToolPart = (part: unknown): part is ToolPart =>
  isObjectRecord(part) &&
  typeof part.type === 'string' &&
  TOOL_PART_TYPES.has(part.type);

export const isApprovalRequestedPart = (part: unknown): boolean => {
  if (!isToolPart(part)) return false;
  if (!getApprovalId(part)) return false;
  return part.type === 'tool-approval-request' || part.state === 'approval-requested';
};

export const isToolResultPart = (part: unknown): boolean => {
  if (!isToolPart(part) || isApprovalRequestedPart(part)) return false;

  if (part.type === 'tool-result' || part.type === 'tool-approval-response') return true;
  if ('output' in part && part.output !== undefined) return true;
  if ('result' in part && part.result !== undefined) return true;

  if ('state' in part && typeof part.state === 'string') {
    return (
      part.state === 'approval-responded' ||
      part.state === 'done' ||
      part.state.startsWith('output-')
    );
  }

  return false;
};

export const isToolCallPart = (part: unknown): boolean =>
  isToolPart(part) && !isApprovalRequestedPart(part) && !isToolResultPart(part);
