import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool } from './base';

const execAsync = promisify(exec);

export class ShellExecutionTool extends BaseTool {
  name = 'shell';
  type = 'function';
  needsApproval = true;
  description =
    'Execute a shell command on the local system. Use this for system operations, installing packages, or running scripts. BE CAREFUL with destructive commands.';

  paramSchema = z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z.string().optional().describe('The working directory in which to execute the command'),
    timeout: z.number().optional().default(30000).describe('Command timeout in milliseconds'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: {
          type: 'string',
          description: 'The working directory in which to execute the command',
        },
        timeout: { type: 'number', description: 'Command timeout in milliseconds' },
      },
      required: ['command'],
    };
  }

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: args.cwd || process.cwd(),
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
