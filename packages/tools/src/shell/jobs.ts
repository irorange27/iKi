import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ShellToolSettingsSchema,
  type ShellToolSettings,
} from '@iki/core/domain/settings';
import { getUserDataPath } from '@iki/core/platform';

export type ShellToolName = 'bash' | 'pwsh';
export type ShellJobStatus = 'running' | 'completed' | 'failed' | 'killed';

export type ShellJobRecord = {
  jobId: string;
  toolName: ShellToolName;
  threadId?: string;
  command: string;
  cwd: string;
  pid: number;
  pgid?: number;
  status: ShellJobStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  logPath: string;
  exitFilePath: string;
  description?: string;
};

export type BoundedLogRead = {
  output: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  truncated: boolean;
  totalLines: number;
  shownLines: number;
};

const POLL_INTERVAL_MS = 120;

export const DEFAULT_SHELL_TOOL_SETTINGS: ShellToolSettings = ShellToolSettingsSchema.parse({});

export const resolveShellToolSettings = (
  override?: Partial<ShellToolSettings> | null
): ShellToolSettings => {
  if (!override) return DEFAULT_SHELL_TOOL_SETTINGS;
  const parsed = ShellToolSettingsSchema.safeParse({
    ...DEFAULT_SHELL_TOOL_SETTINGS,
    ...override,
  });
  return parsed.success ? parsed.data : DEFAULT_SHELL_TOOL_SETTINGS;
};

export const getPrimaryShellToolName = (platform: NodeJS.Platform = process.platform): ShellToolName =>
  platform === 'win32' ? 'pwsh' : 'bash';

const getJobsDir = (): string => {
  const dir = path.join(getUserDataPath(), 'state', 'jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const getJobMetaPath = (jobId: string): string => path.join(getJobsDir(), `${jobId}.json`);

const sanitizeJobId = (jobId: string): string => {
  const trimmed = jobId.trim();
  if (!/^job_[a-zA-Z0-9_-]{4,64}$/.test(trimmed)) {
    throw new Error(`Invalid jobId "${jobId}"`);
  }
  return trimmed;
};

const writeJsonAtomic = (filePath: string, data: unknown): void => {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
};

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const isPidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const resolveBashPath = (customPath?: string): string => {
  const trimmed = customPath?.trim();
  if (trimmed) return trimmed;
  return fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash';
};

const resolvePwshPath = (customPath?: string): string => {
  const trimmed = customPath?.trim();
  return trimmed || 'pwsh.exe';
};

const killProcessGroupSync = (pid: number, pgid: number | undefined, signal: NodeJS.Signals): void => {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        /* already exited */
      }
    }
    return;
  }
  const target = pgid && pgid > 0 ? -pgid : -pid;
  try {
    process.kill(target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      try {
        process.kill(pid, signal);
      } catch {
        /* already exited */
      }
    }
  }
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Tool cancelled', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Tool cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const boundTextToTail = (
  text: string,
  maxLines: number
): { text: string; truncatedByLines: boolean; totalLines: number; shownLines: number } => {
  if (!text) return { text: '', truncatedByLines: false, totalLines: 0, shownLines: 0 };
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return { text, truncatedByLines: false, totalLines, shownLines: totalLines };
  }
  const kept = lines.slice(-maxLines);
  return {
    text: kept.join('\n'),
    truncatedByLines: true,
    totalLines,
    shownLines: kept.length,
  };
};

export const readBoundedLogSlice = (
  logPath: string,
  options?: { offset?: number; maxBytes?: number; maxLines?: number }
): BoundedLogRead => {
  const maxBytes = options?.maxBytes ?? DEFAULT_SHELL_TOOL_SETTINGS.maxOutputBytes;
  const maxLines = options?.maxLines ?? DEFAULT_SHELL_TOOL_SETTINGS.maxOutputLines;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(logPath);
  } catch {
    return {
      output: '',
      offset: options?.offset ?? 0,
      nextOffset: options?.offset ?? 0,
      totalBytes: 0,
      truncated: false,
      totalLines: 0,
      shownLines: 0,
    };
  }

  const totalBytes = stat.size;
  const hasExplicitOffset = typeof options?.offset === 'number' && options.offset >= 0;
  let startOffset = hasExplicitOffset
    ? Math.min(options!.offset!, totalBytes)
    : Math.max(0, totalBytes - maxBytes);
  let truncatedByBytes = !hasExplicitOffset && startOffset > 0;

  let readLength = totalBytes - startOffset;
  if (readLength > maxBytes) {
    startOffset = totalBytes - maxBytes;
    readLength = maxBytes;
    truncatedByBytes = true;
  }

  let raw = '';
  if (readLength > 0) {
    const fd = fs.openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(readLength);
      const bytesRead = fs.readSync(fd, buf, 0, readLength, startOffset);
      raw = buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  const lineBounded = boundTextToTail(raw.trimEnd(), maxLines);
  return {
    output: lineBounded.text,
    offset: startOffset,
    nextOffset: totalBytes,
    totalBytes,
    truncated: truncatedByBytes || lineBounded.truncatedByLines,
    totalLines: lineBounded.totalLines,
    shownLines: lineBounded.shownLines,
  };
};

export const refreshShellJob = (record: ShellJobRecord): ShellJobRecord => {
  if (record.status !== 'running') return record;

  const exitInfo = readJsonFile<{ exitCode?: number | null; finishedAt?: string }>(record.exitFilePath);
  if (exitInfo) {
    const exitCode = typeof exitInfo.exitCode === 'number' ? exitInfo.exitCode : 0;
    const updated: ShellJobRecord = {
      ...record,
      status: exitCode === 0 ? 'completed' : 'failed',
      exitCode,
      finishedAt: exitInfo.finishedAt || new Date().toISOString(),
    };
    writeJsonAtomic(getJobMetaPath(record.jobId), updated);
    return updated;
  }

  if (!isPidAlive(record.pid)) {
    const updated: ShellJobRecord = {
      ...record,
      status: 'killed',
      exitCode: record.exitCode ?? null,
      finishedAt: new Date().toISOString(),
    };
    writeJsonAtomic(getJobMetaPath(record.jobId), updated);
    return updated;
  }

  return record;
};

export const getShellJob = (jobId: string): ShellJobRecord | null => {
  const safeId = sanitizeJobId(jobId);
  const record = readJsonFile<ShellJobRecord>(getJobMetaPath(safeId));
  if (!record) return null;
  return refreshShellJob(record);
};

export const listShellJobs = (options?: { threadId?: string }): ShellJobRecord[] => {
  const dir = getJobsDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const jobs: ShellJobRecord[] = [];
  for (const name of entries) {
    if (!name.startsWith('job_') || !name.endsWith('.json') || name.endsWith('.exit.json')) continue;
    const record = readJsonFile<ShellJobRecord>(path.join(dir, name));
    if (!record || typeof record.jobId !== 'string') continue;
    if (options?.threadId && record.threadId && record.threadId !== options.threadId) continue;
    jobs.push(refreshShellJob(record));
  }
  return jobs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
};

export const killShellJob = async (
  jobId: string
): Promise<{ jobId: string; status: ShellJobStatus; killed: boolean; message: string }> => {
  const job = getShellJob(jobId);
  if (!job) {
    throw new Error(`Job "${jobId}" not found.`);
  }
  if (job.status !== 'running') {
    return {
      jobId: job.jobId,
      status: job.status,
      killed: false,
      message: `Job ${job.jobId} is already ${job.status} (exitCode=${job.exitCode ?? 'null'}).`,
    };
  }

  killProcessGroupSync(job.pid, job.pgid, 'SIGTERM');
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && isPidAlive(job.pid)) {
    await sleep(100);
  }
  if (isPidAlive(job.pid)) {
    killProcessGroupSync(job.pid, job.pgid, 'SIGKILL');
  }

  const updated: ShellJobRecord = {
    ...job,
    status: 'killed',
    exitCode: 137,
    finishedAt: new Date().toISOString(),
  };
  writeJsonAtomic(getJobMetaPath(job.jobId), updated);
  return {
    jobId: job.jobId,
    status: 'killed',
    killed: true,
    message: `Killed job ${job.jobId} (pid ${job.pid}).`,
  };
};

export const readShellJobOutput = async (params: {
  jobId: string;
  offset?: number;
  waitMs?: number;
  settings?: Partial<ShellToolSettings>;
  signal?: AbortSignal;
}): Promise<{
  jobId: string;
  status: ShellJobStatus;
  exitCode: number | null;
  output: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  truncated: boolean;
  logPath: string;
  command: string;
  pid: number;
}> => {
  let job = getShellJob(params.jobId);
  if (!job) {
    throw new Error(`Job "${params.jobId}" not found.`);
  }

  const settings = resolveShellToolSettings(params.settings);
  const waitMs =
    typeof params.waitMs === 'number' && params.waitMs > 0
      ? Math.min(Math.trunc(params.waitMs), settings.maxWaitMs)
      : 0;
  if (waitMs > 0 && job.status === 'running') {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && job.status === 'running') {
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(10, deadline - Date.now())), params.signal);
      job = refreshShellJob(job);
    }
  }

  const slice = readBoundedLogSlice(job.logPath, {
    ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
    maxBytes: settings.maxOutputBytes,
    maxLines: settings.maxOutputLines,
  });

  return {
    jobId: job.jobId,
    status: job.status,
    exitCode: job.exitCode ?? null,
    output: slice.output,
    offset: slice.offset,
    nextOffset: slice.nextOffset,
    totalBytes: slice.totalBytes,
    truncated: slice.truncated,
    logPath: job.logPath,
    command: job.command,
    pid: job.pid,
  };
};

export type StartShellCommandResult = {
  status: ShellJobStatus;
  backgrounded: boolean;
  promotedOnTimeout: boolean;
  jobId: string;
  pid: number;
  cwd: string;
  logPath: string;
  stdout: string;
  exitCode: number | null;
  nextOffset: number;
  totalBytes: number;
  truncated: boolean;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  effectiveTimeoutMs: number;
};

const spawnDurableShellChild = (params: {
  toolName: ShellToolName;
  jobId: string;
  command: string;
  cwd: string;
  logFd: number;
  exitFilePath: string;
  shellPath?: string;
}) => {
  const jobsDir = getJobsDir();
  const cleanCommand = params.command.replace(/\0/g, '');

  if (params.toolName === 'pwsh') {
    const scriptPath = path.join(jobsDir, `${params.jobId}.ps1`);
    const wrapperPath = path.join(jobsDir, `${params.jobId}.runner.ps1`);
    fs.writeFileSync(scriptPath, `${cleanCommand}\n`, 'utf8');
    const wrapperScript = [
      'param([string]$ScriptPath, [string]$ExitPath, [string]$SelfPath)',
      '$ErrorActionPreference = "Continue"',
      '& $ScriptPath',
      '$ec = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
      '$payload = @{ exitCode = $ec; finishedAt = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress',
      'Set-Content -Path "$ExitPath.tmp" -Value $payload -Encoding UTF8',
      'Move-Item -Force "$ExitPath.tmp" $ExitPath',
      'Remove-Item -Force -ErrorAction SilentlyContinue $ScriptPath, $SelfPath',
      'exit $ec',
    ].join('\n');
    fs.writeFileSync(wrapperPath, `${wrapperScript}\n`, 'utf8');

    return spawn(
      resolvePwshPath(params.shellPath),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapperPath, scriptPath, params.exitFilePath, wrapperPath],
      {
        cwd: params.cwd,
        shell: false,
        detached: true,
        windowsHide: true,
        env: { ...process.env },
        stdio: ['ignore', params.logFd, params.logFd],
      }
    );
  }

  const bashPath = resolveBashPath(params.shellPath);
  const scriptPath = path.join(jobsDir, `${params.jobId}.sh`);
  fs.writeFileSync(scriptPath, `${cleanCommand}\n`, { encoding: 'utf8', mode: 0o700 });
  const wrapper = [
    '"$3" "$1"',
    '__iki_ec=$?',
    'printf \'{"exitCode":%d,"finishedAt":"%s"}\\n\' "$__iki_ec" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$2.tmp" && mv "$2.tmp" "$2"',
    'rm -f "$1"',
    'exit "$__iki_ec"',
  ].join('\n');

  return spawn(bashPath, ['-c', wrapper, 'iki-job', scriptPath, params.exitFilePath, bashPath], {
    cwd: params.cwd,
    shell: false,
    detached: true,
    env: { ...process.env },
    stdio: ['ignore', params.logFd, params.logFd],
  });
};

export const startShellCommand = async (params: {
  toolName: ShellToolName;
  command: string;
  cwd: string;
  timeoutMs?: number;
  background?: boolean;
  killOnTimeout?: boolean;
  settings?: Partial<ShellToolSettings>;
  threadId?: string;
  description?: string;
  signal?: AbortSignal;
}): Promise<StartShellCommandResult> => {
  if (params.signal?.aborted) {
    throw new DOMException('Tool cancelled', 'AbortError');
  }

  const settings = resolveShellToolSettings(params.settings);
  const requestedTimeout =
    typeof params.timeoutMs === 'number' && params.timeoutMs > 0
      ? Math.trunc(params.timeoutMs)
      : settings.defaultTimeoutMs;
  const effectiveTimeoutMs = Math.min(Math.max(1, requestedTimeout), settings.maxTimeoutMs);
  const shouldKillOnTimeout =
    typeof params.killOnTimeout === 'boolean' ? params.killOnTimeout : !settings.promoteOnTimeout;

  const jobsDir = getJobsDir();
  const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const logPath = path.join(jobsDir, `${jobId}.log`);
  const exitFilePath = path.join(jobsDir, `${jobId}.exit.json`);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const logFd = fs.openSync(logPath, 'a');
  let logFdClosed = false;
  const closeLogFd = () => {
    if (logFdClosed) return;
    logFdClosed = true;
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore close errors */
    }
  };

  let child: ReturnType<typeof spawn>;
  try {
    child = spawnDurableShellChild({
      toolName: params.toolName,
      jobId,
      command: params.command,
      cwd: params.cwd,
      logFd,
      exitFilePath,
      shellPath: settings.shellPath,
    });
  } catch (error) {
    closeLogFd();
    throw error;
  }

  const pid = child.pid ?? 0;
  const record: ShellJobRecord = {
    jobId,
    toolName: params.toolName,
    ...(params.threadId ? { threadId: params.threadId } : {}),
    command: params.command,
    cwd: params.cwd,
    pid,
    ...(process.platform !== 'win32' && pid > 0 ? { pgid: pid } : {}),
    status: 'running',
    startedAt,
    logPath,
    exitFilePath,
    ...(params.description ? { description: params.description } : {}),
  };
  writeJsonAtomic(getJobMetaPath(jobId), record);

  if (params.background) {
    closeLogFd();
    child.unref();
    return {
      status: 'running',
      backgrounded: true,
      promotedOnTimeout: false,
      jobId,
      pid,
      cwd: params.cwd,
      logPath,
      stdout: '',
      exitCode: null,
      nextOffset: 0,
      totalBytes: 0,
      truncated: false,
      durationMs: Date.now() - startedAtMs,
      timedOut: false,
      killed: false,
      effectiveTimeoutMs,
    };
  }

  const readCurrentOutput = () =>
    readBoundedLogSlice(logPath, {
      maxBytes: settings.maxOutputBytes,
      maxLines: settings.maxOutputLines,
    });

  return new Promise<StartShellCommandResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      params.signal?.removeEventListener('abort', onAbort);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };

    const killChildGroup = () => {
      if (killTimer) return;
      killProcessGroupSync(pid, record.pgid, 'SIGTERM');
      killTimer = setTimeout(() => {
        killed = true;
        killProcessGroupSync(pid, record.pgid, 'SIGKILL');
      }, 3000);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      killed = true;
      cleanup();
      killProcessGroupSync(pid, record.pgid, 'SIGTERM');
      setTimeout(() => {
        if (isPidAlive(pid)) killProcessGroupSync(pid, record.pgid, 'SIGKILL');
      }, 1500).unref();
      closeLogFd();
      writeJsonAtomic(getJobMetaPath(jobId), {
        ...record,
        status: 'killed',
        exitCode: 137,
        finishedAt: new Date().toISOString(),
      } satisfies ShellJobRecord);
      reject(new DOMException('Tool cancelled', 'AbortError'));
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeLogFd();
      const exitCode = code ?? (killed ? 137 : 1);
      const status: ShellJobStatus = killed ? 'killed' : exitCode === 0 ? 'completed' : 'failed';
      writeJsonAtomic(getJobMetaPath(jobId), {
        ...record,
        status,
        exitCode,
        finishedAt: new Date().toISOString(),
      } satisfies ShellJobRecord);
      const slice = readCurrentOutput();
      resolve({
        status,
        backgrounded: false,
        promotedOnTimeout: false,
        jobId,
        pid,
        cwd: params.cwd,
        logPath,
        stdout: slice.output,
        exitCode,
        nextOffset: slice.nextOffset,
        totalBytes: slice.totalBytes,
        truncated: slice.truncated,
        durationMs: Date.now() - startedAtMs,
        timedOut,
        killed,
        effectiveTimeoutMs,
      });
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeLogFd();
      writeJsonAtomic(getJobMetaPath(jobId), {
        ...record,
        status: 'failed',
        exitCode: 1,
        finishedAt: new Date().toISOString(),
      } satisfies ShellJobRecord);
      resolve({
        status: 'failed',
        backgrounded: false,
        promotedOnTimeout: false,
        jobId,
        pid,
        cwd: params.cwd,
        logPath,
        stdout: err.message,
        exitCode: 1,
        nextOffset: 0,
        totalBytes: 0,
        truncated: false,
        durationMs: Date.now() - startedAtMs,
        timedOut: false,
        killed: false,
        effectiveTimeoutMs,
      });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      if (shouldKillOnTimeout) {
        killChildGroup();
        return;
      }
      settled = true;
      cleanup();
      closeLogFd();
      child.unref();
      const slice = readCurrentOutput();
      resolve({
        status: 'running',
        backgrounded: true,
        promotedOnTimeout: true,
        jobId,
        pid,
        cwd: params.cwd,
        logPath,
        stdout: slice.output,
        exitCode: null,
        nextOffset: slice.nextOffset,
        totalBytes: slice.totalBytes,
        truncated: slice.truncated,
        durationMs: Date.now() - startedAtMs,
        timedOut: true,
        killed: false,
        effectiveTimeoutMs,
      });
    }, effectiveTimeoutMs);

    child.once('exit', onExit);
    child.once('error', onError);
    params.signal?.addEventListener('abort', onAbort, { once: true });
    if (params.signal?.aborted) onAbort();
  });
};
