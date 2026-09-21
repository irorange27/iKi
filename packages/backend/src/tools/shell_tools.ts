import { getToolRuntimeContext } from '../utils/runtime_context';
import { spawn } from 'child_process';

import { z } from 'zod';

import { BaseTool } from '@iki/backend/tools/base';
import { ShellToolInputSchema } from './schemas';
import { resolveShellWorkingDirectory } from './workspace_paths';

const MAX_SHELL_TIMEOUT_MS = 600_000;

const runShell = (
  rawCommand: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; killed: boolean }> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Tool cancelled', 'AbortError')); return; }
    const command = rawCommand.replace(/\0/g, '');
    const safeTimeout = Math.min(Math.max(1, Math.trunc(timeoutMs) || 30000), MAX_SHELL_TIMEOUT_MS);
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signalName: NodeJS.Signals) => {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, signalName); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signalName);
        }
      } else child.kill(signalName);
    };
    const terminate = () => {
      if (killTimer) return;
      kill('SIGTERM');
      killTimer = setTimeout(() => { killed = true; kill('SIGKILL'); }, 5000);
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, safeTimeout);
    signal?.addEventListener('abort', terminate, { once: true });
    if (signal?.aborted) terminate();
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', terminate);
    };

    child.on('close', code => {
      cleanup();
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? (killed ? 137 : 1),
        timedOut,
        killed,
      });
    });

    child.on('error', err => {
      cleanup();
      resolve({
        stdout: stdout.trim(),
        stderr: (stderr + err.message).trim(),
        exitCode: 1,
        timedOut: false,
        killed: false,
      });
    });
  });

export class ShellExecutionTool extends BaseTool {
  override name = 'shell';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description =
    'Execute a shell command inside the conversation workspace. Commands can be cancelled; output is returned when the process exits.';

  override paramSchema = ShellToolInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const cwd = await resolveShellWorkingDirectory(args.cwd);
    const requestedTimeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 30000;
    const effectiveTimeout = Math.min(requestedTimeout, MAX_SHELL_TIMEOUT_MS);

    const signal = getToolRuntimeContext().abortSignal;
    const { stdout, stderr, exitCode, timedOut, killed } = await runShell(
      args.command,
      cwd,
      effectiveTimeout,
      signal
    );

    signal?.throwIfAborted();

    const result: Record<string, unknown> = {
      stdout,
      stderr,
      exitCode,
    };

    if (exitCode !== 0 || timedOut || killed) {
      result.isError = true;
      if (timedOut) {
        result.message = `Command timed out after ${effectiveTimeout}ms. Partial output shown above.`;
        result.recovery = {
          hint: 'Increase the timeout or split the work into smaller commands.',
        };
      }
      if (killed) {
        result.message = 'Command was force-killed after timeout.';
      }
    }

    return result;
  }
}
