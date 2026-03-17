import type { UIMessage } from 'ai';

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRole = (role: unknown): 'system' | 'user' | 'assistant' => {
  if (role === 'system' || role === 'assistant' || role === 'user') {
    return role;
  }
  return 'user';
};

const normalizeParts = (parts: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(parts)) return [];
  return parts.filter(part => isObjectRecord(part) && typeof part.type === 'string') as Array<
    Record<string, unknown>
  >;
};

export const parseStoredUiMessage = (row: { id: string; message: string }): UIMessage => {
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
              ? (parsedParts as UIMessage['parts'])
              : ([{ type: 'text', text: '' }] as UIMessage['parts']),
        };
      }

      if (typeof parsed.content === 'string') {
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts: [{ type: 'text', text: parsed.content }],
        };
      }
    }
  } catch {
    // Fallback below.
  }

  return {
    id: row.id,
    role: 'user',
    parts: [{ type: 'text', text: row.message }],
  };
};

