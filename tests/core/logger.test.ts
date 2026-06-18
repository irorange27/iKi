import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('core logger', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LOG_LEVEL;
    delete process.env.IKI_LOG_PROCESS;
  });

  it('builds canonical structured entries and merges async log context', async () => {
    const { createLogger, setBaseLogContext, setLoggingEnabled, withLogContext } =
      await import('@iki/core/logger');

    setLoggingEnabled(false);
    setBaseLogContext({ process: 'main' });

    const moduleLogger = createLogger({ module: 'chat_streaming' });
    const entry = await withLogContext(
      {
        trace_id: 'tr_123',
        entity: { thread_id: 'thread_1' },
        data: { tool_mode: 'auto' },
      },
      async () =>
        moduleLogger.event({
          level: 'info',
          event: 'chat.stream',
          outcome: 'started',
          message: 'Chat stream started',
          entity: { message_id: 'msg_1' },
          data: { model: 'gpt-5.4' },
        })
    );

    expect(entry).toMatchObject({
      schema_version: 1,
      level: 'info',
      process: 'main',
      module: 'chat_streaming',
      event: 'chat.stream',
      outcome: 'started',
      trace_id: 'tr_123',
      entity: {
        thread_id: 'thread_1',
        message_id: 'msg_1',
      },
      data: {
        tool_mode: 'auto',
        model: 'gpt-5.4',
      },
      message: 'Chat stream started',
    });
    expect(entry.ts).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts sensitive data in legacy log calls', async () => {
    const { createLogger, setLoggingEnabled } = await import('@iki/core/logger');

    setLoggingEnabled(false);
    const moduleLogger = createLogger({ module: 'tool_model' });
    const entry = moduleLogger.error('Failed to get tool model', {
      apiKey: 'secret',
      nested: {
        token: 'top-secret',
      },
      reason: 'missing provider',
    });

    expect(entry).toMatchObject({
      event: 'legacy.log',
      level: 'error',
      module: 'tool_model',
      data: {
        apiKey: '[REDACTED]',
        nested: {
          token: '[REDACTED]',
        },
        reason: 'missing provider',
      },
    });
  });

  it('applies runtime logging config from app config', async () => {
    const { applyAppLoggingConfig, getRuntimeLoggingConfig } =
      await import('@iki/core/logger');

    applyAppLoggingConfig({
      security: {
        enableLogging: false,
        logLevel: 'warn',
      },
    } as never);

    expect(getRuntimeLoggingConfig()).toEqual({
      enabled: false,
      level: 'warn',
    });
  });
});
