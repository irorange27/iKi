export type TranslationParams = Record<string, string | number | boolean | null | undefined>;
export type TranslationEntry = string | ((params: TranslationParams) => string);
export type MessageCatalog = Record<string, TranslationEntry>;
export type LocaleCatalog<TBase extends MessageCatalog> = {
  [K in keyof TBase]: TranslationEntry;
};

export const asCount = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

export const asText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

export const defineCatalog = <TCatalog extends MessageCatalog>(catalog: TCatalog): TCatalog =>
  catalog;

export const defineLocaleCatalog = <TBase extends MessageCatalog>(
  catalog: LocaleCatalog<TBase>
): LocaleCatalog<TBase> => catalog;
