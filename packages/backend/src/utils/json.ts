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
