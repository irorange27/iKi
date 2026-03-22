import { exec } from 'child_process';
import { promisify } from 'util';

import { z } from 'zod';

import { BaseTool } from './base';
import { ShellToolInputSchema } from './schemas';
import { resolveShellWorkingDirectory } from './workspace_paths';

const execAsync = promisify(exec);

export class ShellExecutionTool extends BaseTool {
  override name = 'shell';
  override type = 'function';
  override autoAllowed = false;
  override needsApproval = true;
  override description =
    'Execute a shell command inside the conversation workspace. Every invocation requires manual approval.';

  override paramSchema = ShellToolInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    try {
      const cwd = await resolveShellWorkingDirectory(args.cwd);
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout: args.timeout,
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
      };
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: number;
      };
      return {
        stdout: execError.stdout?.trim() || '',
        stderr: execError.stderr?.trim() || execError.message || 'Command execution failed',
        exitCode: execError.code || 1,
        isError: true,
      };
    }
  }
}
