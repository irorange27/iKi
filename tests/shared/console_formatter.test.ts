import { describe, expect, it } from 'vitest';

import { formatStructuredConsoleLine } from '../../src/shared/logging/console_formatter';

describe('structured console formatter', () => {
  it('formats the console line with time, process, level, scope, and extras', () => {
    const line = formatStructuredConsoleLine(
      {
        ts: '2026-03-22T07:42:08.142Z',
        level: 'info',
        process: 'main',
        module: 'settings_window',
        event: 'window.closed',
        message: 'Settings window closed',
        data: {
          window_kind: 'settings',
        },
      },
      {
        colorize: false,
        timeZone: 'Asia/Shanghai',
      }
    );

    expect(line).toBe(
      '[15:42:08.142] [main] [info] [main/settings_window] window.closed Settings window closed {"data":{"window_kind":"settings"}}'
    );
  });

  it('does not duplicate event and outcome when the message is the fallback text', () => {
    const line = formatStructuredConsoleLine(
      {
        ts: '2026-03-22T07:42:08.142Z',
        level: 'info',
        process: 'main',
        module: 'chat_streaming',
        event: 'chat.stream',
        outcome: 'started',
        message: 'chat.stream started',
      },
      {
        colorize: false,
        timeZone: 'Asia/Shanghai',
      }
    );

    expect(line).toBe('[15:42:08.142] [main] [info] [main/chat_streaming] chat.stream started');
  });

  it('colorizes the timestamp and level labels when ANSI colors are enabled', () => {
    const line = formatStructuredConsoleLine(
      {
        ts: '2026-03-22T07:42:08.142Z',
        level: 'warn',
        process: 'main',
        module: 'settings_window',
        event: 'window.closed',
        message: 'Settings window closed',
      },
      {
        colorize: true,
        timeZone: 'Asia/Shanghai',
      }
    );

    expect(line).toContain('\u001B[36m[15:42:08.142]\u001B[0m');
    expect(line).toContain('\u001B[33m[warn]\u001B[0m');
    expect(line).toContain('[main]');
    expect(line).toContain('[main/settings_window]');
    expect(line).toContain('window.closed Settings window closed');
  });
});
