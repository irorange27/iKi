const hasStructuredClone = typeof structuredClone === 'function';

type NumberTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

type BigIntTypedArray = BigInt64Array | BigUint64Array;
type TypedArray = NumberTypedArray | BigIntTypedArray;

const isTypedArray = (value: unknown): value is TypedArray =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

const isBigIntTypedArray = (value: TypedArray): value is BigIntTypedArray =>
  value instanceof BigInt64Array || value instanceof BigUint64Array;

const cloneTypedArray = <T extends TypedArray>(value: T): T => {
  if (isBigIntTypedArray(value)) {
    const TypedArrayConstructor = value.constructor as new (input: ArrayLike<bigint>) => T;
    return new TypedArrayConstructor(value);
  }

  const TypedArrayConstructor = value.constructor as new (input: ArrayLike<number>) => T;
  return new TypedArrayConstructor(value);
};

const cloneFallback = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
  if (value === null) return null;

  const valueType = typeof value;
  if (
    valueType === 'string' ||
    valueType === 'number' ||
    valueType === 'boolean' ||
    valueType === 'bigint' ||
    valueType === 'undefined'
  ) {
    return value;
  }

  if (valueType === 'function' || valueType === 'symbol') {
    return undefined;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (value instanceof DataView) {
    return new DataView(value.buffer.slice(0) as ArrayBufferLike, value.byteOffset, value.byteLength);
  }

  if (isTypedArray(value)) {
    return cloneTypedArray(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return seen.get(value);
    }

    const next: unknown[] = [];
    seen.set(value, next);

    for (const item of value) {
      const cloned = cloneFallback(item, seen);
      next.push(typeof cloned === 'undefined' ? null : cloned);
    }

    return next;
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return seen.get(value);
    }

    const next = new Map<unknown, unknown>();
    seen.set(value, next);

    for (const [key, entryValue] of value.entries()) {
      const clonedKey = cloneFallback(key, seen);
      const clonedValue = cloneFallback(entryValue, seen);
      if (typeof clonedKey === 'undefined' || typeof clonedValue === 'undefined') continue;
      next.set(clonedKey, clonedValue);
    }

    return next;
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return seen.get(value);
    }

    const next = new Set<unknown>();
    seen.set(value, next);

    for (const entry of value.values()) {
      const cloned = cloneFallback(entry, seen);
      if (typeof cloned === 'undefined') continue;
      next.add(cloned);
    }

    return next;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  const next: Record<string, unknown> = {};
  seen.set(value, next);

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;

    const cloned = cloneFallback((value as Record<string, unknown>)[key], seen);
    if (typeof cloned === 'undefined') continue;
    next[key] = cloned;
  }

  return next;
};

export const toPlainData = <T>(value: T): T => {
  if (hasStructuredClone) {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to the object/array copier for Proxy-backed or otherwise non-cloneable values.
    }
  }

  try {
    return cloneFallback(value, new WeakMap()) as T;
  } catch {
    // Fall through to the JSON round-trip as a final plain-data backstop.
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
};
