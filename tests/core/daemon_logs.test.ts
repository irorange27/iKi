import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';

describe('daemon_logs', () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-daemon-logs-'));
    process.env.IKI_LOG_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.IKI_LOG_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes canonical structured daemon log entries and reads them back', async () => {
    const { setBaseLogContext, setLogLevel, setLoggingEnabled } =
      await import('@iki/core/logger');
    const { daemonLog, readRecentDaemonLogs } = await import('@iki/core/daemon_logs');

    setBaseLogContext({ process: 'main' });
    setLoggingEnabled(true);
    setLogLevel('error');

    const written = daemonLog.info('napcat', 'Bridge connected', { remote: '127.0.0.1' }, tempDir);
    const read = readRecentDaemonLogs(10, tempDir);

    expect(written).toMatchObject({
      level: 'info',
      process: 'daemon',
      module: 'napcat',
      event: 'legacy.log',
      source: 'napcat',
      message: 'Bridge connected',
      data: {
        remote: '127.0.0.1',
      },
    });
    expect(read.filePath).toBe(path.join(tempDir, 'logs', 'daemon.log'));
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]).toMatchObject({
      level: 'info',
      process: 'daemon',
      module: 'napcat',
      event: 'legacy.log',
      source: 'napcat',
      timestamp: written.ts,
      message: 'Bridge connected',
    });
    expect(read.napcatMessages).toEqual([]);
  });

  it('parses legacy daemon log lines for compatibility', async () => {
    const { readRecentDaemonLogs, getDaemonLogFilePath } =
      await import('@iki/core/daemon_logs');

    const filePath = getDaemonLogFilePath(tempDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: '2026-03-19T00:00:00.000Z',
        level: 'warn',
        source: 'daemon-lifecycle',
        message: 'Existing daemon detected',
      })}\n`,
      'utf8'
    );

    const read = readRecentDaemonLogs(10, tempDir);

    expect(read.entries).toEqual([
      {
        ts: '2026-03-19T00:00:00.000Z',
        timestamp: '2026-03-19T00:00:00.000Z',
        schema_version: 1,
        level: 'warn',
        process: 'daemon',
        module: 'daemon-lifecycle',
        event: 'legacy.log',
        source: 'daemon-lifecycle',
        message: 'Existing daemon detected',
      },
    ]);
    expect(read.napcatMessages).toEqual([]);
  });

  it('records recent NapCat message previews independently from the log level setting', async () => {
    const { setLoggingEnabled, setLogLevel } = await import('@iki/core/logger');
    const { readRecentDaemonLogs, recordNapCatMessagePreview } =
      await import('@iki/core/daemon_logs');

    setLoggingEnabled(false);
    setLogLevel('error');

    recordNapCatMessagePreview(
      {
        receivedAt: '2026-03-22T08:00:00.000Z',
        messageType: 'group',
        userId: '20002',
        groupId: '30003',
        selfId: '10001',
        messageId: 'msg_preview',
        textPreview: 'hello from qq',
        mentionedSelf: false,
        replyEligible: false,
      },
      tempDir
    );

    const read = readRecentDaemonLogs(10, tempDir);

    expect(read.entries).toEqual([]);
    expect(read.napcatMessages).toEqual([
      {
        receivedAt: '2026-03-22T08:00:00.000Z',
        messageType: 'group',
        userId: '20002',
        groupId: '30003',
        selfId: '10001',
        messageId: 'msg_preview',
        textPreview: 'hello from qq',
        mentionedSelf: false,
        replyEligible: false,
      },
    ]);
  });
});
