import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '@iki/backend/tools/base';
import { RetryableError } from '@iki/core/utils/errors';

// ---- Minimal concrete tools for testing ----

const TestSchema = z.object({ value: z.string() });

class NoRetryTool extends BaseTool<typeof TestSchema> {
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

// ---- Tests ----

describe('BaseTool without retry/cache (backward compat)', () => {
  it('behaves exactly as before when no retry/cache config', async () => {
    const tool = new NoRetryTool();
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
    const tool = new NoRetryTool();
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

describe('BaseTool without cache', () => {
  it('calls handler on repeated execute calls', async () => {
    const tool = new NoRetryTool();
    let handlerCalls = 0;
    vi.spyOn(tool as unknown as { handler: typeof tool['handler'] }, 'handler').mockImplementation(
      async (args: z.infer<typeof TestSchema>) => {
        handlerCalls++;
        return { result: args.value };
      }
    );

    await tool.execute({ value: 'a' });
    await tool.execute({ value: 'a' });

    expect(handlerCalls).toBe(2);
  });
});
