import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '@iki/core/tools/base';
import { RetryableError } from '@iki/core/utils/errors';

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
  it('propagates retry config via toAgentTool', () => {
    const tool = new RetryTool();
    const agentTool = tool.toAgentTool();
    expect(agentTool.retry).toEqual({ maxRetries: 2, backoffMs: 1 });
  });

  it('does not propagate retry when not configured', () => {
    const tool = new NoRetryNoCacheTool();
    const agentTool = tool.toAgentTool();
    expect(agentTool.retry).toBeUndefined();
  });

  it('calls handler once without retry in execute', async () => {
    const tool = new RetryTool();
    let calls = 0;
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        calls++;
        if (calls < 3) throw new RetryableError('transient');
        return { result: args.value };
      }
    );

    // execute() no longer retries — it delegates retry to buildAiToolSet
    await expect(tool.execute({ value: 'retry-test' })).rejects.toThrow('transient');
    expect(calls).toBe(1);
  });

  it('validates args before calling handler', async () => {
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
