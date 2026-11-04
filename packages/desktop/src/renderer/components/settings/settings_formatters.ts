export const formatLabel = (key: string): string =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());

export const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const formatJson = (raw: string | null | undefined): string => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
};
