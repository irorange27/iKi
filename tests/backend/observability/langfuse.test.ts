import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isLangfuseEnabled,
  initLangfuseTracing,
  langfuseTelemetry,
  shutdownLangfuseTracing,
} from '@iki/backend/observability/langfuse';

describe('langfuse helpers', () => {
  const original = {
    pub: process.env.LANGFUSE_PUBLIC_KEY,
    sec: process.env.LANGFUSE_SECRET_KEY,
  };

  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  afterEach(async () => {
    await shutdownLangfuseTracing();
    if (original.pub) process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    else delete process.env.LANGFUSE_PUBLIC_KEY;
    if (original.sec) process.env.LANGFUSE_SECRET_KEY = 'sk';
    else delete process.env.LANGFUSE_SECRET_KEY;
  });

  it('is a no-op when credentials are missing', () => {
    initLangfuseTracing();
    expect(isLangfuseEnabled()).toBe(false);
    expect(langfuseTelemetry('any', { sessionId: 't1' })).toBeUndefined();
  });

  it('returns a telemetry payload once initialized', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    initLangfuseTracing();
    expect(isLangfuseEnabled()).toBe(true);

    const t = langfuseTelemetry('chat.stream', {
      sessionId: 'thread-1',
      empty: '',
      nope: undefined,
    });
    expect(t).toEqual({
      isEnabled: true,
      functionId: 'chat.stream',
      metadata: { sessionId: 'thread-1' },
    });
  });

  it('records a real generation span with usage and cost through tracePiGeneration', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    initLangfuseTracing();
    expect(isLangfuseEnabled()).toBe(true);

    const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import(
      '@opentelemetry/sdk-trace-base'
    );
    const { setLangfuseTracerProvider } = await import('@langfuse/tracing');
    const exporter = new InMemorySpanExporter();
    setLangfuseTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    );

    const { tracePiGeneration } = await import('@iki/backend/observability/langfuse');
    const settleArgs: unknown[] = [];
    const result = await tracePiGeneration(
      {
        name: 'pi.chat.generate',
        model: 'gpt-5-mini',
        provider: 'openai',
        sessionId: 'thread-langfuse',
        modelParameters: { maxTokens: 2048 },
        input: [{ role: 'user', content: 'hi' }],
      },
      onSettle => {
        onSettle({
          output: 'hello there',
          usageDetails: { input: 12, output: 5, total: 17 },
          costUsd: 0.0042,
        });
        settleArgs.push('settled');
        return Promise.resolve('the-answer');
      }
    );

    expect(result).toBe('the-answer');
    expect(settleArgs).toEqual(['settled']);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe('pi.chat.generate');
    expect(span.spanContext().traceId).toBeTruthy();
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['langfuse.observation.type']).toBe('generation');
    expect(attrs['langfuse.observation.model.name']).toBe('gpt-5-mini');
    expect(attrs['langfuse.observation.metadata.supply']).toBe('pi');
    expect(attrs['langfuse.observation.metadata.provider']).toBe('openai');
    const usage = JSON.parse(String(attrs['langfuse.observation.usage_details'] ?? '{}'));
    expect(usage).toMatchObject({ input: 12, output: 5, total: 17 });
    const cost = JSON.parse(String(attrs['langfuse.observation.cost_details'] ?? '{}'));
    expect(cost).toMatchObject({ total: 0.0042 });
    expect(attrs['langfuse.observation.output']).toBe('hello there');
  });
});
