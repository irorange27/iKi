const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_RANDOM_LENGTH = 7;

const getSafeRandomLength = (value?: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_RANDOM_LENGTH;
  }
  return value;
};

const createRandomSuffix = (length: number): string => {
  const targetLength = getSafeRandomLength(length);
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(targetLength);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, byte => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
  }

  let suffix = '';
  while (suffix.length < targetLength) {
    suffix += Math.random().toString(36).slice(2);
  }
  return suffix.slice(0, targetLength);
};

export const createPrefixedId = (
  prefix: string,
  options?: {
    randomLength?: number;
    now?: number;
  }
): string => {
  const normalizedPrefix = prefix.trim() || 'id';
  const timestamp =
    typeof options?.now === 'number' && Number.isFinite(options.now)
      ? Math.trunc(options.now)
      : Date.now();

  return `${normalizedPrefix}_${timestamp}_${createRandomSuffix(options?.randomLength ?? DEFAULT_RANDOM_LENGTH)}`;
};
