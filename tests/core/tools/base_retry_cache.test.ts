import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../../src/core/tools/base';
import { RetryableError } from '../../../src/shared/utils/errors';

// ---- Minimal concrete tools for testing ----

const TestSchema = z.object({ value: z.string() });

class NoRetryNoCacheTool extends BaseTool<typeof TestSchema> {
  override name = 'test_bare';
  override type = 'function';
  override description = 'Bare tool';
  override paramSchema = TestSchema;

  protected override async handler(args: z.infer<typeof TestSchema>): Promise<unknown> {
    return { result: args.value };
  }
}

class RetryTool extends BaseTool<typeof TestSchema> {
  override name = 'test_retry';
  override type = 'function';
  override description = 'Retry tool';
  override paramSchema = TestSchema;
  override retry = { maxRetries: 2, backoffMs: 1 };

  protected override async handler(args: z.infer<typeof TestSchema>): Promise<unknown> {
    return { result: args.value };
  }
}

class CacheTool extends BaseTool<typeof TestSchema> {
  override name = 'test_cache';
  override type = 'function';
  override description = 'Cache tool';
  override paramSchema = TestSchema;
  override cache = { ttlMs: 60_000 };

  protected override async handler(args: z.infer<typeof TestSchema>): Promise<unknown> {
    return { result: args.value };
  }
}

// ---- Tests ----

describe('BaseTool without retry/cache (backward compat)', () => {
  it('behaves exactly as before when no retry/cache config', async () => {
    const tool = new NoRetryNoCacheTool();
    const result = await tool.execute({ value: 'hello' });
    expect(result).toEqual({ result: 'hello' });
  });
});

describe('BaseTool with retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries handler on RetryableError', async () => {
    const tool = new RetryTool();
    let calls = 0;
    // Override handler for this test
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        calls++;
        if (calls < 3) throw new RetryableError('transient');
        return { result: args.value };
      }
    );

    const p = tool.execute({ value: 'retry-test' });
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(1 * Math.pow(2, i));
    }
    const result = await p;
    expect(result).toEqual({ result: 'retry-test' });
    expect(calls).toBe(3);
  });

  it('does not retry on plain Error', async () => {
    const tool = new RetryTool();
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockRejectedValue(
      new Error('not transient')
    );

    await expect(tool.execute({ value: 'x' })).rejects.toThrow('not transient');
  });

  it('validates args before retrying', async () => {
    const tool = new RetryTool();
    await expect(tool.execute({ value: 123 })).rejects.toThrow(); // Zod validation fails
  });
});

describe('BaseTool with cache', () => {
  it('returns cached result on second call', async () => {
    const tool = new CacheTool();
    let handlerCalls = 0;
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        handlerCalls++;
        return { result: args.value };
      }
    );

    const r1 = await tool.execute({ value: 'cached' });
    const r2 = await tool.execute({ value: 'cached' });

    expect(r1).toEqual({ result: 'cached' });
    expect(r2).toEqual({ result: 'cached' });
    expect(handlerCalls).toBe(1); // second call served from cache
  });

  it('does not cache when cache is not configured', async () => {
    const tool = new NoRetryNoCacheTool();
    let handlerCalls = 0;
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        handlerCalls++;
        return { result: args.value };
      }
    );

    await tool.execute({ value: 'a' });
    await tool.execute({ value: 'a' });

    expect(handlerCalls).toBe(2); // no caching
  });

  it('different args produce different cache keys', async () => {
    const tool = new CacheTool();
    let handlerCalls = 0;
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        handlerCalls++;
        return { result: args.value };
      }
    );

    await tool.execute({ value: 'a' });
    await tool.execute({ value: 'b' });

    expect(handlerCalls).toBe(2); // different args, both miss cache
  });

  it('does not cache errors', async () => {
    const tool = new CacheTool();
    let handlerCalls = 0;
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async () => {
        handlerCalls++;
        throw new Error('boom');
      }
    );

    await expect(tool.execute({ value: 'err' })).rejects.toThrow('boom');
    await expect(tool.execute({ value: 'err' })).rejects.toThrow('boom');

    expect(handlerCalls).toBe(2); // errors not cached
  });

  it('deduplicates concurrent calls for the same key', async () => {
    const tool = new CacheTool();
    let handlerCalls = 0;

    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        handlerCalls++;
        return { result: args.value };
      }
    );

    // Fire two concurrent calls with same args
    const [r1, r2] = await Promise.all([
      tool.execute({ value: 'concurrent' }),
      tool.execute({ value: 'concurrent' }),
    ]);

    expect(r1).toEqual({ result: 'concurrent' });
    expect(r2).toEqual({ result: 'concurrent' });
    // The second call should get the in-flight promise from the first
    expect(handlerCalls).toBe(1);
  });
});
