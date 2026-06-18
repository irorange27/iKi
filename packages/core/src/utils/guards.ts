export type ObjectRecord = Record<string, unknown>;

export const isObjectRecord = (value: unknown): value is ObjectRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
