import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAppSettings } from '@iki/core/domain/settings';
import { setPlatformInfo } from '@iki/core/platform';
import {
  createShellTools,
  getPrimaryShellToolName,
  killShellJob,
  listShellJobs,
  readBoundedLogSlice,
  readShellJobOutput,
  startShellCommand,
} from '../src/shell';

describe('@iki/tools shell plugin & durable background jobs', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-tools-shell-'));
    setPlatformInfo({ userDataPath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('selects bash on POSIX and pwsh on Windows alongside job tool', () => {
    expect(getPrimaryShellToolName('darwin')).toBe('bash');
    expect(getPrimaryShellToolName('linux')).toBe('bash');
    expect(getPrimaryShellToolName('win32')).toBe('pwsh');

    const posixTools = createShellTools({ platform: 'darwin' }).map(t => t.name);
    expect(posixTools).toEqual(['bash', 'job']);

    const winTools = createShellTools({ platform: 'win32' }).map(t => t.name);
    expect(winTools).toEqual(['pwsh', 'job']);
  });

  it('parses [tools.shell] settings with defaults and user overrides', () => {
    const defaults = parseAppSettings({});
    expect(defaults.tools.shell).toEqual({
      defaultTimeoutMs: 30000,
      maxTimeoutMs: 600000,
      promoteOnTimeout: true,
      maxOutputBytes: 24000,
      maxOutputLines: 200,
      defaultWaitMs: 15000,
      maxWaitMs: 120000,
      shellPath: '',
    });

    const overridden = parseAppSettings({
      tools: {
        shell: {
          defaultTimeoutMs: 45000,
          promoteOnTimeout: false,
          maxOutputLines: 50,
        },
      },
    });
    expect(overridden.tools.shell.defaultTimeoutMs).toBe(45000);
    expect(overridden.tools.shell.promoteOnTimeout).toBe(false);
    expect(overridden.tools.shell.maxOutputLines).toBe(50);
    expect(overridden.tools.shell.maxTimeoutMs).toBe(600000);
  });

  it('runs a foreground bash command and honors injected [tools.shell] settings', async () => {
    if (process.platform === 'win32') return;
    const res = await startShellCommand({
      toolName: 'bash',
      command: 'for i in $(seq 1 15); do echo "row-$i"; done',
      cwd: tmpDir,
      settings: { maxOutputLines: 5 },
      threadId: 'thread-fg',
    });

    expect(res.backgrounded).toBe(false);
    expect(res.status).toBe('completed');
    expect(res.exitCode).toBe(0);
    expect(res.truncated).toBe(true);
    expect(res.stdout).toContain('row-15');
    expect(res.stdout).not.toContain('row-1\n');
    expect(fs.existsSync(res.logPath)).toBe(true);
  });

  it('auto-promotes on timeout when promoteOnTimeout=true and kills when promoteOnTimeout=false', async () => {
    if (process.platform === 'win32') return;

    const promoted = await startShellCommand({
      toolName: 'bash',
      command: 'echo step-one; sleep 0.35; echo promoted-finished',
      cwd: tmpDir,
      settings: { defaultTimeoutMs: 120, promoteOnTimeout: true },
      threadId: 'thread-promote',
    });
    expect(promoted.backgrounded).toBe(true);
    expect(promoted.promotedOnTimeout).toBe(true);
    expect(promoted.status).toBe('running');

    const done = await readShellJobOutput({
      jobId: promoted.jobId,
      offset: 0,
      waitMs: 5_000,
    });
    expect(done.status).toBe('completed');
    expect(done.exitCode).toBe(0);
    expect(done.output).toContain('promoted-finished');

    const killed = await startShellCommand({
      toolName: 'bash',
      command: 'sleep 10',
      cwd: tmpDir,
      settings: { defaultTimeoutMs: 100, promoteOnTimeout: false },
      threadId: 'thread-kill-timeout',
    });
    expect(killed.backgrounded).toBe(false);
    expect(killed.timedOut).toBe(true);
    expect(killed.status).not.toBe('completed');
  });

  it('starts an explicit background job, lists it, and kills it cleanly', async () => {
    if (process.platform === 'win32') return;
    const started = await startShellCommand({
      toolName: 'bash',
      command: 'echo bg-started; sleep 30',
      cwd: tmpDir,
      background: true,
      threadId: 'thread-bg',
    });

    expect(started.backgrounded).toBe(true);
    expect(started.promotedOnTimeout).toBe(false);
    expect(started.status).toBe('running');

    const jobs = listShellJobs({ threadId: 'thread-bg' });
    expect(jobs.some(j => j.jobId === started.jobId && j.status === 'running')).toBe(true);

    const killed = await killShellJob(started.jobId);
    expect(killed.killed).toBe(true);
    expect(killed.status).toBe('killed');
  });

  it('bounds huge log reads to the tail and tracks nextOffset', () => {
    const logPath = path.join(tmpDir, 'big.log');
    const lines = Array.from({ length: 350 }, (_, idx) => `log-line-${idx + 1}`).join('\n') + '\n';
    fs.writeFileSync(logPath, lines, 'utf8');

    const slice = readBoundedLogSlice(logPath, { maxLines: 20 });
    expect(slice.truncated).toBe(true);
    expect(slice.shownLines).toBe(20);
    expect(slice.output).toContain('log-line-350');
    expect(slice.output).not.toContain('log-line-1\n');
    expect(slice.nextOffset).toBe(Buffer.byteLength(lines, 'utf8'));
  });
});
