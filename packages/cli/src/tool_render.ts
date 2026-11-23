import os from 'node:os';
import { cliTheme } from './theme';

const OUTPUT_PREVIEW_LINES = 6;
const COMMAND_PREVIEW_LINES = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const shortenPath = (targetPath: string): string => {
  const home = os.homedir();
  return targetPath === home || targetPath.startsWith(`${home}/`)
    ? `~${targetPath.slice(home.length)}`
    : targetPath;
};

const formatDuration = (ms?: number): string => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatTimeout = (ms: number): string =>
  ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;

const unwrapToolOutput = (raw: unknown): Record<string, unknown> | string | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw)) return String(raw);
  if (raw.type === 'json' && raw.value !== undefined) {
    return unwrapToolOutput(raw.value);
  }
  if ((raw.type === 'text' || raw.type === 'error-text') && typeof raw.value === 'string') {
    return raw.value;
  }
  return raw;
};

const isShellToolName = (toolName: string): boolean =>
  toolName === 'bash' || toolName === 'pwsh' || toolName === 'shell';

const formatShellCommandLines = (
  toolName: string,
  input: Record<string, unknown>
): { header: string; extraLines: string[] } => {
  const prompt = toolName === 'pwsh' ? 'PS>' : '$';
  const rawCmd = typeof input.command === 'string' ? input.command.trim() : '';
  const cmdLines = rawCmd ? rawCmd.split(/\r?\n/) : ['...'];

  const meta: string[] = [];
  if (typeof input.cwd === 'string' && input.cwd.trim()) {
    meta.push(`cwd: ${shortenPath(input.cwd.trim())}`);
  }
  if (typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout !== 30_000) {
    meta.push(`timeout ${formatTimeout(Math.trunc(input.timeout))}`);
  }
  if (input.background === true) {
    meta.push('bg');
  }
  const metaSuffix = meta.length > 0 ? `  ${cliTheme.dim(`(${meta.join(' · ')})`)}` : '';

  const header = `${cliTheme.bold(cliTheme.accent(prompt))} ${cliTheme.bold(cliTheme.text(cmdLines[0]))}${metaSuffix}`;
  const extraLines: string[] = [];
  if (cmdLines.length > 1) {
    const shown = cmdLines.slice(1, COMMAND_PREVIEW_LINES);
    for (const line of shown) {
      extraLines.push(`  ${cliTheme.text(line)}`);
    }
    if (cmdLines.length > COMMAND_PREVIEW_LINES) {
      extraLines.push(cliTheme.dim(`  ... (+${cmdLines.length - COMMAND_PREVIEW_LINES} more lines)`));
    }
  }
  if (typeof input.description === 'string' && input.description.trim()) {
    extraLines.push(`  ${cliTheme.dim(input.description.trim())}`);
  }
  return { header, extraLines };
};

const formatJobCallHeader = (input: Record<string, unknown>): { header: string; extraLines: string[] } => {
  const action = typeof input.action === 'string' ? input.action : 'status';
  const jobId = typeof input.jobId === 'string' ? input.jobId : '';
  const meta: string[] = [];
  if (typeof input.offset === 'number') meta.push(`offset ${input.offset}`);
  if (typeof input.waitMs === 'number') meta.push(`wait ${formatTimeout(input.waitMs)}`);
  if (input.allThreads === true) meta.push('all threads');
  const suffix = meta.length > 0 ? ` ${cliTheme.dim(`(${meta.join(' · ')})`)}` : '';
  const header = `${cliTheme.bold(cliTheme.accent('job'))} ${cliTheme.bold(cliTheme.text(action))}${jobId ? ` ${cliTheme.text(jobId)}` : ''}${suffix}`;
  const extraLines =
    typeof input.description === 'string' && input.description.trim()
      ? [`  ${cliTheme.dim(input.description.trim())}`]
      : [];
  return { header, extraLines };
};

const formatGenericCallHeader = (
  toolName: string,
  input: unknown
): { header: string; extraLines: string[] } => {
  if (!isRecord(input)) {
    return { header: cliTheme.bold(cliTheme.text(toolName)), extraLines: [] };
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const entries = Object.entries(input)
    .filter(([k, v]) => k !== 'description' && v !== undefined)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : JSON.stringify(v);
      const clipped = val.length > 60 ? `${val.slice(0, 57)}...` : val;
      return `${k}=${clipped}`;
    });
  const argsText = entries.join(' ');
  const clippedArgs = argsText.length > 120 ? `${argsText.slice(0, 117)}...` : argsText;
  const header = clippedArgs
    ? `${cliTheme.bold(cliTheme.text(toolName))} ${cliTheme.dim(clippedArgs)}`
    : cliTheme.bold(cliTheme.text(toolName));
  return {
    header,
    extraLines: description ? [`  ${cliTheme.dim(description)}`] : [],
  };
};

const formatCallParts = (
  toolName: string,
  input: unknown
): { header: string; extraLines: string[] } => {
  if (isShellToolName(toolName) && isRecord(input)) {
    return formatShellCommandLines(toolName, input);
  }
  if (toolName === 'job' && isRecord(input)) {
    return formatJobCallHeader(input);
  }
  return formatGenericCallHeader(toolName, input);
};

const formatTailPreviewLines = (text: string, maxLines = OUTPUT_PREVIEW_LINES): string[] => {
  const trimmed = text.trimEnd();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  const result: string[] = [];
  if (lines.length > maxLines) {
    result.push(`  ${cliTheme.dim(`... (${lines.length - maxLines} earlier lines)`)}`);
  }
  for (const line of lines.slice(-maxLines)) {
    result.push(`  ${cliTheme.muted(line)}`);
  }
  return result;
};

export const formatToolCallPending = (toolName: string, input: unknown): string => {
  const { header, extraLines } = formatCallParts(toolName, input);
  return [`${cliTheme.warning('•')} ${header}`, ...extraLines].join('\n');
};

export const formatToolCallPipedSummary = (toolName: string, input: unknown): string => {
  if (isShellToolName(toolName) && isRecord(input) && typeof input.command === 'string') {
    const prompt = toolName === 'pwsh' ? 'PS>' : '$';
    const firstLine = input.command.trim().split(/\r?\n/)[0] ?? '';
    return `${prompt} ${firstLine}`;
  }
  if (toolName === 'job' && isRecord(input)) {
    const action = typeof input.action === 'string' ? input.action : 'status';
    const jobId = typeof input.jobId === 'string' ? ` ${input.jobId}` : '';
    return `${action}${jobId}`;
  }
  if (!isRecord(input)) return '';
  const raw = JSON.stringify(input);
  return raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
};

export type RenderedToolCompletion = {
  text: string;
  tone: 'success' | 'background' | 'error';
};

export const formatToolCallCompleted = (params: {
  toolName: string;
  input: unknown;
  output: unknown;
  elapsedMs?: number;
}): RenderedToolCompletion => {
  const { toolName, input, output, elapsedMs } = params;
  const { header, extraLines } = formatCallParts(toolName, input);
  const unwrapped = unwrapToolOutput(output);

  if (isShellToolName(toolName) && isRecord(unwrapped)) {
    const backgrounded = unwrapped.backgrounded === true;
    const exitCode = typeof unwrapped.exitCode === 'number' ? unwrapped.exitCode : null;
    const duration = formatDuration(
      typeof unwrapped.durationMs === 'number' ? unwrapped.durationMs : elapsedMs
    );
    const stdout = typeof unwrapped.stdout === 'string' ? unwrapped.stdout : '';
    const stderr = typeof unwrapped.stderr === 'string' ? unwrapped.stderr : '';
    const combined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');
    const previewLines = formatTailPreviewLines(combined);

    if (backgrounded) {
      const jobId = typeof unwrapped.jobId === 'string' ? unwrapped.jobId : 'job';
      const pid = typeof unwrapped.pid === 'number' ? ` · pid ${unwrapped.pid}` : '';
      const logPath = typeof unwrapped.logPath === 'string' ? ` · ${shortenPath(unwrapped.logPath)}` : '';
      const badge = cliTheme.warning('⚡');
      const footer = cliTheme.warning(
        `  [background ${jobId}${pid}${duration ? ` · ${duration}` : ''}${logPath}]`
      );
      return {
        tone: 'background',
        text: [`${badge} ${header}`, ...extraLines, ...previewLines, footer].join('\n'),
      };
    }

    const failed = unwrapped.isError === true || (exitCode !== null && exitCode !== 0);
    const badge = failed ? cliTheme.error('✗') : cliTheme.success('✓');
    const metaParts: string[] = [];
    if (exitCode !== null) metaParts.push(`exit ${exitCode}`);
    if (duration) metaParts.push(duration);
    if (unwrapped.truncated === true && typeof unwrapped.logPath === 'string') {
      metaParts.push(`full log: ${shortenPath(unwrapped.logPath)}`);
    }
    const footer = metaParts.length
      ? `  ${(failed ? cliTheme.error : cliTheme.dim)(`[${metaParts.join(' · ')}]`)}`
      : '';
    return {
      tone: failed ? 'error' : 'success',
      text: [`${badge} ${header}`, ...extraLines, ...previewLines, ...(footer ? [footer] : [])].join('\n'),
    };
  }

  if (toolName === 'job' && isRecord(unwrapped)) {
    const failed = unwrapped.isError === true;
    const badge = failed ? cliTheme.error('✗') : cliTheme.success('✓');
    const bodyLines: string[] = [];
    if (Array.isArray(unwrapped.jobs)) {
      const jobs = unwrapped.jobs as Array<Record<string, unknown>>;
      if (jobs.length === 0) {
        bodyLines.push(`  ${cliTheme.dim('(no background jobs)')}`);
      } else {
        for (const job of jobs.slice(0, 8)) {
          const cmd = String(job.command ?? '').replace(/\s+/g, ' ').slice(0, 50);
          bodyLines.push(`  ${cliTheme.muted(`${job.jobId} [${job.status}] pid=${job.pid} ${cmd}`)}`);
        }
      }
    } else if (typeof unwrapped.output === 'string') {
      bodyLines.push(...formatTailPreviewLines(unwrapped.output));
      const status = typeof unwrapped.status === 'string' ? unwrapped.status : '';
      const exitStr = typeof unwrapped.exitCode === 'number' ? ` · exit ${unwrapped.exitCode}` : '';
      const bytesStr = typeof unwrapped.totalBytes === 'number' ? ` · ${unwrapped.totalBytes}B` : '';
      bodyLines.push(`  ${cliTheme.dim(`[${status}${exitStr}${bytesStr}]`)}`);
    } else if (typeof unwrapped.message === 'string') {
      bodyLines.push(`  ${cliTheme.muted(unwrapped.message)}`);
    }
    return {
      tone: failed ? 'error' : 'success',
      text: [`${badge} ${header}`, ...extraLines, ...bodyLines].join('\n'),
    };
  }

  const duration = formatDuration(elapsedMs);
  const previewText =
    typeof unwrapped === 'string'
      ? unwrapped
      : unwrapped
        ? JSON.stringify(unwrapped, null, 2)
        : '';
  const previewLines = formatTailPreviewLines(previewText, 4);
  const footer = duration ? [`  ${cliTheme.dim(`[${duration}]`)}`] : [];
  return {
    tone: 'success',
    text: [`${cliTheme.success('✓')} ${header}`, ...extraLines, ...previewLines, ...footer].join('\n'),
  };
};

export const formatToolCallError = (params: {
  toolName: string;
  input: unknown;
  errorText: string;
}): string => {
  const { header, extraLines } = formatCallParts(params.toolName, params.input);
  return [
    `${cliTheme.error('✗')} ${header}`,
    ...extraLines,
    `  ${cliTheme.error(params.errorText)}`,
  ].join('\n');
};
