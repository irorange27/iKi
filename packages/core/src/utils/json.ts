import { isObjectRecord } from './guards';

export const parseJsonObjectRecord = (
  value: string | null | undefined
): Record<string, unknown> => {
  if (!value?.trim()) return {};

  try {
    const parsed = JSON.parse(value);
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const parseJsonStringArray = (value: string | null | undefined): string[] => {
  if (!value?.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
};
