export const toIsoNow = (date: Date = new Date()): string => date.toISOString();

export const normalizeWhitespace = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

export const normalizeOptionalWhitespace = (value: unknown): string | null =>
  normalizeWhitespace(value) || null;

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
