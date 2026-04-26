import { describe, expect, it, vi, afterEach } from 'vitest';
import { ToolResultCache, buildCacheKey } from '../../../src/core/tools/cache';

describe('ToolResultCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a value', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });
    cache.set('key1', { data: 'hello' });
    expect(cache.get('key1')).toEqual({ data: 'hello' });
  });

  it('returns undefined for missing keys', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('expires entries after TTL', async () => {
    vi.useFakeTimers();
    const cache = new ToolResultCache({ ttlMs: 1000 });
    cache.set('key1', 'value1');

    // Within TTL
    vi.advanceTimersByTime(500);
    expect(cache.get('key1')).toBe('value1');

    // After TTL
    vi.advanceTimersByTime(600);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('evicts oldest entries when exceeding maxSize', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000, maxSize: 3 });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a' (oldest by insertion order)

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('re-promotes recently accessed entries (LRU)', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000, maxSize: 3 });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to promote it
    cache.get('a');

    // Insert a new entry — should evict 'b' (now the oldest)
    cache.set('d', 4);

    expect(cache.get('a')).toBe(1); // promoted, still present
    expect(cache.get('b')).toBeUndefined(); // evicted
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('deletes a specific key', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });
    cache.set('key1', 'value1');
    cache.delete('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('clears all entries', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('deduplicates in-flight requests', async () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });

    let resolvePromise!: (v: unknown) => void;
    const promise = new Promise<unknown>(resolve => {
      resolvePromise = resolve;
    });

    cache.setInFlight('key1', promise);

    // Concurrent caller should get the same in-flight promise
    const inFlight = cache.getInFlight('key1');
    expect(inFlight).toBe(promise);

    // Resolve and clean up
    resolvePromise!('result');
    cache.deleteInFlight('key1');
    expect(cache.getInFlight('key1')).toBeNull();
  });

  it('clears in-flight tracker after promise completes in execute flow', async () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });

    cache.setInFlight('key1', Promise.resolve('result'));

    // After the promise resolves and deleteInFlight is called,
    // getInFlight should return null
    cache.deleteInFlight('key1');
    expect(cache.getInFlight('key1')).toBeNull();
  });

  it('prunes expired entries on get access', () => {
    vi.useFakeTimers();
    const cache = new ToolResultCache({ ttlMs: 1000 });

    cache.set('a', 1);
    cache.set('b', 2);

    vi.advanceTimersByTime(1001);

    // get('a') triggers prune — both 'a' and 'b' should be expired
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('reports size correctly', () => {
    const cache = new ToolResultCache({ ttlMs: 60_000 });
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });
});

describe('buildCacheKey', () => {
  it('generates consistent keys for the same input', () => {
    const key1 = buildCacheKey('read_file', { path: '/tmp/test.txt', offset: 100 });
    const key2 = buildCacheKey('read_file', { path: '/tmp/test.txt', offset: 100 });
    expect(key1).toBe(key2);
  });

  it('generates different keys for different tool names', () => {
    const key1 = buildCacheKey('read_file', { path: '/tmp/test.txt' });
    const key2 = buildCacheKey('list_dir', { path: '/tmp/test.txt' });
    expect(key1).not.toBe(key2);
  });

  it('generates different keys for different args', () => {
    const key1 = buildCacheKey('read_file', { path: '/tmp/a.txt' });
    const key2 = buildCacheKey('read_file', { path: '/tmp/b.txt' });
    expect(key1).not.toBe(key2);
  });

  it('is order-independent for object keys', () => {
    const key1 = buildCacheKey('tool', { a: 1, b: 2 });
    const key2 = buildCacheKey('tool', { b: 2, a: 1 });
    expect(key1).toBe(key2);
  });
});
