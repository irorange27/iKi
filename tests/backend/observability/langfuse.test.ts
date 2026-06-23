// ponytail: smallest runnable check for the langfuse helpers.
// Run with: pnpm vitest run tests/backend/observability/langfuse.test.ts
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
    if (original.pub) process.env.LANGFUSE_PUBLIC_KEY = original.pub;
    else delete process.env.LANGFUSE_PUBLIC_KEY;
    if (original.sec) process.env.LANGFUSE_SECRET_KEY = original.sec;
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
});
