export const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
};

export const parseJsonStringArray = (raw: string | null | undefined): string[] => {
  if (!raw || typeof raw !== 'string') return [];
  try {
    return toStringArray(JSON.parse(raw));
  } catch {
    return toStringArray(raw);
  }
};

/**
 * Parse a JSON string and shape it through `resolve`; any failure (non-string,
 * blank, invalid JSON, resolve returning null) yields `fallback`. Callers with
 * tri-state needs (distinguish "absent" from "explicit null") need their own
 * parser — see workspaces/thread_workspace.ts.
 */
export const parseJsonOr = <T>(
  raw: unknown,
  resolve: (parsed: unknown) => T | null,
  fallback: T
): T => {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return resolve(parsed) ?? fallback;
  } catch {
    return fallback;
  }
};
