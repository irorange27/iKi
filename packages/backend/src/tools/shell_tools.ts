import { spawn } from 'child_process';

import { z } from 'zod';

import { BaseTool } from '@iki/core/tools/base';
import { ShellToolInputSchema } from '@iki/core/tools/schemas';
import { resolveShellWorkingDirectory } from './workspace_paths';

const MAX_SHELL_TIMEOUT_MS = 600_000;

const runShell = (
  rawCommand: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; killed: boolean }> =>
  new Promise(resolve => {
    const command = rawCommand.replace(/\0/g, '');
    const safeTimeout = Math.min(Math.max(1, Math.trunc(timeoutMs) || 30000), MAX_SHELL_TIMEOUT_MS);
    const child = spawn(command, {
      cwd,
      shell: true,
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // If still alive after 5s, force kill
      setTimeout(() => {
        if (child.exitCode === null) {
          killed = true;
          child.kill('SIGKILL');
        }
      }, 5000);
    }, safeTimeout);

    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? (killed ? 137 : 1),
        timedOut,
        killed,
      });
    });

    child.on('error', err => {
      clearTimeout(timer);
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
  override description =
    'Execute a shell command inside the conversation workspace. Long-running commands stream partial output and can be cancelled.';

  override paramSchema = ShellToolInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const cwd = await resolveShellWorkingDirectory(args.cwd);
    const requestedTimeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 30000;
    const effectiveTimeout = Math.min(requestedTimeout, MAX_SHELL_TIMEOUT_MS);

    let { stdout, stderr, exitCode, timedOut, killed } = await runShell(
      args.command,
      cwd,
      effectiveTimeout
    );

    // Retry once with double timeout for transient timeout (not kill)
    if (timedOut && !killed) {
      const retryResult = await runShell(args.command, cwd, Math.min(effectiveTimeout * 2, MAX_SHELL_TIMEOUT_MS));
      stdout = retryResult.stdout;
      stderr = retryResult.stderr;
      exitCode = retryResult.exitCode;
      timedOut = retryResult.timedOut;
      killed = retryResult.killed;
    }

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
