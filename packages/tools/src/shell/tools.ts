import path from 'node:path';
import type { ShellToolSettings } from '@iki/core/domain/settings';
import { getToolRuntimeContext } from '@iki/core/utils/runtime_context';
import { BaseTool, type ToolRegistry } from '@iki/agent/base_tool';
import { z } from 'zod';
import {
  DEFAULT_SHELL_TOOL_SETTINGS,
  getPrimaryShellToolName,
  killShellJob,
  listShellJobs,
  readShellJobOutput,
  resolveShellToolSettings,
  startShellCommand,
  type ShellToolName,
} from './jobs';
import { JobToolInputSchema, ShellToolInputSchema } from './schema';

export type ShellToolPluginDeps = {
  /** Reads live `[tools.shell]` settings from host config; defaults to schema defaults. */
  getSettings?: () => Partial<ShellToolSettings> | null | undefined;
  /** Resolves working directory against active thread workspace; defaults to process.cwd(). */
  resolveCwd?: (cwd?: string) => Promise<string>;
  /** Platform override for OS-specific tool selection (`bash` vs `pwsh`). */
  platform?: NodeJS.Platform;
};

const defaultResolveCwd = async (cwd?: string): Promise<string> =>
  cwd?.trim() ? path.resolve(cwd.trim()) : process.cwd();

const readLiveSettings = (deps?: ShellToolPluginDeps): ShellToolSettings => {
  try {
    return resolveShellToolSettings(deps?.getSettings?.());
  } catch {
    return DEFAULT_SHELL_TOOL_SETTINGS;
  }
};

abstract class BaseShellExecutionTool extends BaseTool {
  protected abstract readonly shellToolName: ShellToolName;
  private readonly deps: ShellToolPluginDeps;

  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override replay = 'unsafe' as const;
  override approvalMode = 'always' as const;
  override paramSchema = ShellToolInputSchema;

  constructor(deps: ShellToolPluginDeps = {}) {
    super();
    this.deps = deps;
  }

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const settings = readLiveSettings(this.deps);
    const resolveCwd = this.deps.resolveCwd ?? defaultResolveCwd;
    const cwd = await resolveCwd(args.cwd);

    const runtime = getToolRuntimeContext();
    const signal = runtime.abortSignal;
    const res = await startShellCommand({
      toolName: this.shellToolName,
      command: args.command,
      cwd,
      ...(typeof args.timeout === 'number' && args.timeout > 0 ? { timeoutMs: args.timeout } : {}),
      background: args.background === true,
      ...(typeof args.killOnTimeout === 'boolean' ? { killOnTimeout: args.killOnTimeout } : {}),
      settings,
      ...(runtime.threadId ? { threadId: runtime.threadId } : {}),
      ...(args.description ? { description: args.description } : {}),
      signal,
    });

    signal?.throwIfAborted();

    if (res.backgrounded) {
      return {
        status: 'running',
        backgrounded: true,
        promotedOnTimeout: res.promotedOnTimeout,
        jobId: res.jobId,
        pid: res.pid,
        cwd: res.cwd,
        logPath: res.logPath,
        stdout: res.stdout,
        nextOffset: res.nextOffset,
        totalBytes: res.totalBytes,
        ...(res.truncated ? { truncated: true } : {}),
        durationMs: res.durationMs,
        message: res.promotedOnTimeout
          ? `Command still running after ${res.effectiveTimeoutMs}ms and was moved to durable background job ${res.jobId} (pid ${res.pid}). Use \`job\` with action="wait" or action="output" (offset=${res.nextOffset}) to check progress, or action="kill" to stop it.`
          : `Started durable background job ${res.jobId} (pid ${res.pid}). Use \`job\` with action="output" or action="wait" to read progress, or action="kill" to stop it.`,
      };
    }

    const result: Record<string, unknown> = {
      stdout: res.stdout,
      stderr: '',
      exitCode: res.exitCode ?? 1,
      durationMs: res.durationMs,
      ...(res.truncated ? { truncated: true, totalBytes: res.totalBytes, logPath: res.logPath } : {}),
    };

    if ((res.exitCode ?? 1) !== 0 || res.timedOut || res.killed) {
      result.isError = true;
      if (res.timedOut) {
        result.message = `Command timed out and was killed after ${res.effectiveTimeoutMs}ms. Partial output shown above.`;
      }
    }

    return result;
  }
}

export class BashExecutionTool extends BaseShellExecutionTool {
  protected override readonly shellToolName = 'bash' as const;
  override name = 'bash';
  override description =
    'Execute a Bash command in the workspace (macOS/Linux). Foreground commands that outlive `timeout` automatically promote to a durable background job (configurable via `[tools.shell]`); pass `background: true` for long-running servers or builds, and manage them with `job`.';
}

export class PwshExecutionTool extends BaseShellExecutionTool {
  protected override readonly shellToolName = 'pwsh' as const;
  override name = 'pwsh';
  override description =
    'Execute a PowerShell 7 (`pwsh`) command in the workspace (Windows). Foreground commands that outlive `timeout` automatically promote to a durable background job (configurable via `[tools.shell]`); pass `background: true` for long-running servers or builds, and manage them with `job`.';
}

export class JobControlTool extends BaseTool {
  private readonly deps: ShellToolPluginDeps;

  override name = 'job';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override replay = 'safe' as const;
  override approvalMode = 'configurable' as const;
  override description =
    'Inspect, wait on, read logs from, or terminate durable background shell jobs (survive CLI restarts).';
  override paramSchema = JobToolInputSchema;

  constructor(deps: ShellToolPluginDeps = {}) {
    super();
    this.deps = deps;
  }

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const settings = readLiveSettings(this.deps);
    const runtime = getToolRuntimeContext();
    if (args.action === 'list') {
      const jobs = listShellJobs(
        args.allThreads ? undefined : runtime.threadId ? { threadId: runtime.threadId } : undefined
      );
      return {
        jobs: jobs.slice(0, 30).map(job => ({
          jobId: job.jobId,
          toolName: job.toolName,
          status: job.status,
          pid: job.pid,
          exitCode: job.exitCode ?? null,
          startedAt: job.startedAt,
          ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
          cwd: job.cwd,
          command: job.command,
          logPath: job.logPath,
        })),
      };
    }

    if (!args.jobId?.trim()) {
      return { isError: true, message: `jobId is required for action="${args.action}".` };
    }

    if (args.action === 'kill') {
      return killShellJob(args.jobId);
    }

    const waitMs = args.action === 'wait' ? (args.waitMs ?? settings.defaultWaitMs) : 0;
    return readShellJobOutput({
      jobId: args.jobId,
      ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
      waitMs,
      settings,
      signal: runtime.abortSignal,
    });
  }
}

export const createShellTools = (deps: ShellToolPluginDeps = {}): BaseTool[] => [
  getPrimaryShellToolName(deps.platform) === 'pwsh'
    ? new PwshExecutionTool(deps)
    : new BashExecutionTool(deps),
  new JobControlTool(deps),
];

export const registerShellTools = (
  registry: Pick<ToolRegistry, 'register'>,
  deps: ShellToolPluginDeps = {}
): BaseTool[] => {
  const tools = createShellTools(deps);
  for (const tool of tools) {
    registry.register(tool);
  }
  return tools;
};
