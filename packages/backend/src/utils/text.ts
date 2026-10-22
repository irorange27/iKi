export const toIsoNow = (date: Date = new Date()): string => date.toISOString();

export const normalizeWhitespace = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

export const normalizeOptionalWhitespace = (value: unknown): string | null =>
  normalizeWhitespace(value) || null;

export const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeOptionalProviderId = (value: unknown): string | null => {
  if (value === null) return null;
  return normalizeWhitespace(value) || null;
};

export const clampNonNegativeInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

export const clampNonNegativeNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

const truncateText = (value: string, maxChars?: number): string => {
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) {
    return value;
  }

  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return '.'.repeat(maxChars);
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
};

const replacePromptControlChars = (value: string): string => {
  let sanitized = '';

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isControl =
      (code >= 0x00 && code <= 0x1f) || code === 0x7f || code === 0x2028 || code === 0x2029;
    sanitized += isControl ? ' ' : char;
  }

  return sanitized;
};

export const sanitizePromptMetadataText = (
  value: unknown,
  options?: { maxChars?: number }
): string => {
  if (typeof value !== 'string') return '';

  const sanitized = replacePromptControlChars(value).trim().replace(/\s+/g, ' ');

  if (!sanitized) return '';
  return truncateText(sanitized, options?.maxChars);
};

export const stringifyPromptData = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export const clampListLimit = (value: unknown, fallback: number, max: number): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(asNumber)));
};
