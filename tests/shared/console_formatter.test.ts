import { describe, expect, it } from 'vitest';

import { formatStructuredConsoleLine } from '@iki/core/logging/console_formatter';

describe('structured console formatter', () => {
  it('formats a console line with time, level, scope, body, and compact extras', () => {
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
      '[15:42:08.142] [INFO] [main/settings_window] window.closed  Settings window closed window_kind=settings'
    );
  });

  it('does not duplicate event and outcome when the message matches the fallback', () => {
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

    expect(line).toBe('[15:42:08.142] [INFO] [main/chat_streaming] chat.stream  started');
  });

  it('colorizes timestamp, level, scope, event, and outcome with distinct ANSI colors', () => {
    const line = formatStructuredConsoleLine(
      {
        ts: '2026-03-22T07:42:08.142Z',
        level: 'warn',
        process: 'main',
        module: 'settings_window',
        event: 'window.closed',
        outcome: 'started',
        message: 'Settings window closed',
      },
      {
        colorize: true,
        timeZone: 'Asia/Shanghai',
      }
    );

    // timestamp: cyan
    expect(line).toContain('\u001B[36m[15:42:08.142]\u001B[0m');
    // level: yellow
    expect(line).toContain('\u001B[33m[WARN]\u001B[0m');
    // scope: green
    expect(line).toContain('\u001B[32m[main/settings_window]\u001B[0m');
    // event: bold
    expect(line).toContain('\u001B[1mwindow.closed\u001B[0m');
    // outcome: yellow (started)
    expect(line).toContain('\u001B[33mstarted\u001B[0m');
    // message: default (no color)
    expect(line).toContain('Settings window closed');
  });

  it('shows duration in human-readable form and shortens trace/request/session ids', () => {
    const line = formatStructuredConsoleLine(
      {
        ts: '2026-03-22T07:42:08.142Z',
        level: 'info',
        process: 'main',
        module: 'chat_streaming',
        event: 'chat.stream',
        outcome: 'succeeded',
        message: 'Stream completed',
        trace_id: 'abcdef1234567890abcdef1234567890',
        request_id: 'req_1234567890abcdef',
        session_id: 'ses_abcdef1234567890',
        duration_ms: 1234,
      },
      {
        colorize: false,
        timeZone: 'Asia/Shanghai',
      }
    );

    expect(line).toBe(
      '[15:42:08.142] [INFO] [main/chat_streaming] chat.stream  succeeded  Stream completed +1.2s  tid=abcdef12  rid=req_1234  sid=ses_abcd'
    );
  });

  it('renders error as a compact name: message pair without stack trace', () => {
    const line = formatStructuredConsoleLine(
      {
        ts: '2026-03-22T07:42:08.142Z',
        level: 'error',
        process: 'main',
        module: 'database',
        event: 'query',
        outcome: 'failed',
        error: { name: 'SqliteError', message: 'no such table: threads' },
      },
      {
        colorize: false,
        timeZone: 'Asia/Shanghai',
      }
    );

    expect(line).toBe(
      '[15:42:08.142] [ERROR] [main/database] query  failed error=SqliteError: no such table: threads'
    );
  });
});
