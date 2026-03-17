import type { TextPart, UiMessagePart } from './message_parts';
import { isObjectRecord } from './message_parts';

export type StoredUiMessageRow = { id: string; message: string };

export type ParsedUiMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: UiMessagePart[];
};

const normalizeRole = (role: unknown): ParsedUiMessage['role'] => {
  if (role === 'system' || role === 'assistant' || role === 'user') {
    return role;
  }
  return 'user';
};

const normalizeParts = (parts: unknown): UiMessagePart[] => {
  if (!Array.isArray(parts)) return [];
  return parts.filter(part => isObjectRecord(part) && typeof part.type === 'string') as UiMessagePart[];
};

export const parseStoredUiMessageRow = (row: StoredUiMessageRow): ParsedUiMessage => {
  try {
    const parsed = JSON.parse(row.message);
    if (isObjectRecord(parsed)) {
      if (Array.isArray(parsed.parts)) {
        const parsedParts = normalizeParts(parsed.parts);
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts:
            parsedParts.length > 0
              ? parsedParts
              : ([{ type: 'text', text: '' } as TextPart] as UiMessagePart[]),
        };
      }

      if (typeof parsed.content === 'string') {
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts: [{ type: 'text', text: parsed.content } as TextPart],
        };
      }
    }
  } catch {
    // Fallback below.
  }

  return {
    id: row.id,
    role: 'user',
    parts: [{ type: 'text', text: row.message } as TextPart],
  };
};
