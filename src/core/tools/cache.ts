import { createLogger } from '../logger';

const cacheLogger = createLogger({ module: 'tool_cache' });

// FNV-1a hash for consistent cache key generation (matching chat_memory.ts pattern)
function hashArgs(value: unknown): string {
  const serialized = JSON.stringify(value, Object.keys(value as object).sort());
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

interface CacheEntry {
  value: unknown;
  createdAt: number;
}

export interface ToolCacheConfig {
  /** TTL in milliseconds. */
  ttlMs: number;
  /** Maximum number of entries before LRU eviction kicks in. Default 500. */
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 500;

// Global registry of tool cache instances for cross-tool invalidation
const toolCaches = new Map<string, ToolResultCache>();

/** Register a tool's cache so mutating tools can invalidate it. */
export function registerToolCache(toolName: string, cache: ToolResultCache): void {
  toolCaches.set(toolName, cache);
}

/**
 * Clear caches for tools matching the predicate.
 * Used by mutating tools to invalidate stale read-caches after writes.
 */
export function invalidateCaches(predicate: (toolName: string) => boolean): void {
  for (const [name, cache] of toolCaches) {
    if (predicate(name)) {
      cache.clear();
      cacheLogger.event({
        level: 'debug',
        event: 'tool.cache',
        outcome: 'cancelled',
        entity: { tool_name: name },
        message: 'invalidated',
      });
    }
  }
}

/**
 * Per-tool-instance result cache with TTL expiration, LRU eviction, and
 * in-flight request deduplication.
 */
export class ToolResultCache {
  private store = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private ttlMs: number;
  private maxSize: number;

  constructor(config: ToolCacheConfig) {
    this.ttlMs = Math.max(1, Math.trunc(config.ttlMs));
    this.maxSize = Math.max(1, Math.trunc(config.maxSize ?? DEFAULT_MAX_SIZE));
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
    // LRU eviction via Map insertion order (oldest entries first)
    while (this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
  }

  get(key: string): unknown | undefined {
    this.prune();
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    // Re-insert to mark as recently used (maintains LRU order)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown): void {
    this.prune();
    this.store.set(key, { value, createdAt: Date.now() });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Returns the in-flight promise if one exists, otherwise null. */
  getInFlight(key: string): Promise<unknown> | null {
    return this.inFlight.get(key) ?? null;
  }

  /** Stores an in-flight promise for deduplication. */
  setInFlight(key: string, promise: Promise<unknown>): void {
    this.inFlight.set(key, promise);
  }

  /** Clears the in-flight tracker for a key. */
  deleteInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Build a deterministic cache key from a tool name and its arguments.
 * Uses FNV-1a hash of JSON-stably-sorted args for consistency.
 */
export function buildCacheKey(toolName: string, args: unknown): string {
  return `${toolName}:${hashArgs(args)}`;
}
