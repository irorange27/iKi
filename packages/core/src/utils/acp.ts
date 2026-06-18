import { ACP_DYNAMIC_TOOL_NAME } from '../constants/acp';

export type AcpDynamicToolPayload = {
  toolCallId?: string;
  toolName: string;
  args: unknown;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const parseAcpDynamicToolPayload = (value: unknown): AcpDynamicToolPayload | null => {
  const record =
    typeof value === 'string'
      ? (() => {
          const trimmed = value.trim();
          if (!trimmed) return null;
          try {
            const parsed = JSON.parse(trimmed);
            return isObjectRecord(parsed) ? parsed : null;
          } catch {
            return null;
          }
        })()
      : isObjectRecord(value)
        ? value
        : null;

  if (!record) return null;

  const toolName = normalizeString(record.toolName);
  if (!toolName) return null;

  return {
    ...(normalizeString(record.toolCallId) ? { toolCallId: normalizeString(record.toolCallId) } : {}),
    toolName,
    args: record.args ?? {},
  };
};

export const unwrapAcpDynamicToolCall = (value: {
  toolName?: unknown;
  input?: unknown;
  args?: unknown;
}): AcpDynamicToolPayload | null => {
  if (normalizeString(value.toolName) !== ACP_DYNAMIC_TOOL_NAME) {
    return null;
  }

  return parseAcpDynamicToolPayload(value.input !== undefined ? value.input : value.args);
};
