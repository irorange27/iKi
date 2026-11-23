import { isObjectRecord } from '../message_parts';

export const getApprovalIdValue = (
  part: Record<string, unknown>,
  options?: { allowEmpty?: boolean }
): string | null => {
  const allowEmpty = options?.allowEmpty ?? false;
  if (typeof part.approvalId === 'string') {
    if (allowEmpty || part.approvalId.length > 0) return part.approvalId;
  }
  if (isObjectRecord(part.approval) && typeof part.approval.id === 'string') {
    if (allowEmpty || part.approval.id.length > 0) return part.approval.id;
  }
  return null;
};

export const getApprovalId = (part: unknown): string | null => {
  if (!isObjectRecord(part)) return null;
  return getApprovalIdValue(part, { allowEmpty: true });
};

export const getToolCallIdFromPart = (part: unknown): string | null => {
  if (!isObjectRecord(part)) return null;
  if (typeof part.toolCallId === 'string' && part.toolCallId.length > 0) return part.toolCallId;
  if (typeof part.id === 'string' && part.id.length > 0) return part.id;
  if (isObjectRecord(part.toolCall) && typeof part.toolCall.toolCallId === 'string') {
    return part.toolCall.toolCallId;
  }
  return null;
};
