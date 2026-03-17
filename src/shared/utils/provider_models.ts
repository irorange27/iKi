const normalizeModelList = (models: unknown[]): string[] =>
  models
    .filter((model): model is string => typeof model === 'string')
    .map(model => model.trim())
    .filter(Boolean);

export const parseModelList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return normalizeModelList(value);
  }

  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizeModelList(parsed);
    }
  } catch {
    return [];
  }

  return [];
};
