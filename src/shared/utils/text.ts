export const toIsoNow = (date: Date = new Date()): string => date.toISOString();

export const normalizeWhitespace = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

export const normalizeOptionalWhitespace = (value: unknown): string | null =>
  normalizeWhitespace(value) || null;
