type ParseMaybeJsonOptions = {
  emptyStringValue?: unknown;
};

export const parseMaybeJson = (
  value: unknown,
  options?: ParseMaybeJsonOptions
): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return options?.emptyStringValue ?? value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

export const parseToolInputFromText = (inputText: string): unknown =>
  parseMaybeJson(inputText, { emptyStringValue: {} });
