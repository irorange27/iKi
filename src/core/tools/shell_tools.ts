import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool } from './base';
import { getConfig } from '../db/database';
import type { AppConfig } from '../../shared/types/config';
import { ShellToolInputSchema } from './schemas';

const execAsync = promisify(exec);
const invalidCustomShellPatterns = new Set<string>();
const highRiskShellPatterns: RegExp[] = [
  /\bsudo\b/i,
  /(^|[;&|]\s*)(rm|rmdir)\b/i,
  /\brm\s+-[^\n]*r[^\n]*f\b/i,
  /\bdd\b/i,
  /\bmkfs(?:\.[a-z0-9_]+)?\b/i,
  /\b(fdisk|parted|diskutil)\b/i,
  /\b(shutdown|reboot|poweroff|halt|init\s+0)\b/i,
  /\b(killall|pkill|kill\s+-9)\b/i,
  /\b(useradd|userdel|usermod|passwd)\b/i,
  /\b(chown|chmod)\b[^\n]*\b(777|000)\b/i,
  /\b(curl|wget)\b[^|\n]*\|\s*(bash|sh|zsh)\b/i,
  /(^|[;&|]\s*):\(\)\s*\{\s*:\|\s*:\s*&\s*\};\s*:/,
];

const criticalPathWritePattern = /(?:^|[;&|]\s*)(?:echo|cat|tee|printf|sed)\b[^\n]*(?:>|>>|\|\s*tee(?:\s+-a)?)\s*\/(?:etc|bin|sbin|usr|var|private|System|Library)\b/i;

const normalizeShellApprovalMode = (
  value: unknown
): AppConfig['toolExecution']['shellApprovalMode'] => {
  if (value === 'always' || value === 'never' || value === 'high-risk') {
    return value;
  }
  return 'high-risk';
};

const getShellApprovalConfig = (): AppConfig['toolExecution'] => {
  const rawConfig = getConfig('app_config');
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {
      shellApprovalMode: 'high-risk',
      shellHighRiskPatterns: [],
    };
  }

  const toolExecution = (rawConfig as Partial<AppConfig>).toolExecution;
  const customPatterns = Array.isArray(toolExecution?.shellHighRiskPatterns)
    ? toolExecution.shellHighRiskPatterns
        .filter((pattern): pattern is string => typeof pattern === 'string')
        .map(pattern => pattern.trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];

  return {
    shellApprovalMode: normalizeShellApprovalMode(toolExecution?.shellApprovalMode),
    shellHighRiskPatterns: customPatterns,
  };
};

const parseShellRegexPattern = (pattern: string): RegExp | null => {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('/')) {
      const lastSlashIndex = trimmed.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        const body = trimmed.slice(1, lastSlashIndex);
        const flags = trimmed.slice(lastSlashIndex + 1) || 'i';
        return new RegExp(body, flags);
      }
    }

    return new RegExp(trimmed, 'i');
  } catch (error) {
    if (!invalidCustomShellPatterns.has(trimmed)) {
      invalidCustomShellPatterns.add(trimmed);
      console.warn(
        `[ShellTool] Invalid custom high-risk regex ignored: ${trimmed}`,
        error
      );
    }
    return null;
  }
};

const isHighRiskShellCommand = (command: string, customPatterns: string[] = []): boolean => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return true;
  if (trimmedCommand.length > 4000) return true;

  if (criticalPathWritePattern.test(trimmedCommand)) {
    return true;
  }

  if (highRiskShellPatterns.some(pattern => pattern.test(trimmedCommand))) {
    return true;
  }

  for (const customPattern of customPatterns) {
    const compiledPattern = parseShellRegexPattern(customPattern);
    if (compiledPattern?.test(trimmedCommand)) {
      return true;
    }
  }

  return false;
};

export class ShellExecutionTool extends BaseTool {
  name = 'shell';
  type = 'function';
  needsApproval = (input: unknown) => {
    if (typeof input !== 'object' || input === null) return true;
    const command = (input as { command?: unknown }).command;
    if (typeof command !== 'string') return true;

    const shellApprovalConfig = getShellApprovalConfig();
    if (shellApprovalConfig.shellApprovalMode === 'always') return true;
    if (shellApprovalConfig.shellApprovalMode === 'never') return false;
    return isHighRiskShellCommand(command, shellApprovalConfig.shellHighRiskPatterns);
  };
  description =
    'Execute a shell command on the local system. Use this for system operations, installing packages, or running scripts. BE CAREFUL with destructive commands.';

  paramSchema = ShellToolInputSchema;

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
