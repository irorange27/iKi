import { spawn } from 'child_process';

import { z } from 'zod';

import { BaseTool } from '@iki/core/tools/base';
import { ShellToolInputSchema } from './schemas';
import { resolveShellWorkingDirectory } from './workspace_paths';

const MAX_SHELL_TIMEOUT_MS = 600_000;

// ── Read-only command detection ────────────────────────────────────────────
//
// Shell commands that only inspect or query state (no filesystem writes,
// no network mutations, no process control) are classified as read-only.
// These skip approval gating and are available to delegated sub-agents.
//
// The LLM is not malicious — a pattern-based allowlist catches normal usage.
// Unknown commands default to "needs approval" (fail safe).

const SPLIT_PATTERN = /(?:&&|;|\|\||\|(?!\s*\w+\s*=)|[\n\r])/;

/** Commands whose primary purpose is inspection / querying. */
const READONLY_COMMANDS = new Set([
  // File reading / inspection
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'zcat', 'bzcat', 'xzcat',
  // Searching
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'find', 'locate', 'which', 'whereis', 'type',
  // Counting / measuring
  'wc', 'du', 'df', 'stat', 'file', 'md5', 'md5sum', 'sha1sum', 'sha256sum', 'cksum',
  // System info
  'ps', 'top', 'htop', 'uptime', 'uname', 'hostname', 'whoami', 'who', 'id', 'groups',
  'pwd', 'date', 'env', 'printenv', 'tty', 'arch', 'sysctl', 'nproc',
  // Network inspection
  'ping', 'traceroute', 'nslookup', 'dig', 'host', 'netstat', 'ss', 'ifconfig', 'ip',
  // Process listing
  'pgrep', 'pidof', 'lsof',
  // Text output
  'echo', 'printf', 'true', 'false', 'yes',
  // Calculation
  'expr', 'bc', 'awk', 'sed',
  // Version checks
  'node', 'python', 'python3', 'ruby', 'perl', 'go', 'rustc', 'cargo', 'java', 'javac',
  'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'gem', 'composer', 'brew', 'port',
  'docker', 'kubectl', 'helm', 'git',
  // Help / man
  'man', 'help', 'info', 'apropos', 'whatis',
]);

/** Sub-commands of multi-call binaries that are read-only. */
const READONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set([
    'log', 'diff', 'show', 'status', 'branch', 'blame', 'tag', 'stash', 'rev-parse',
    'rev-list', 'ls-files', 'ls-tree', 'ls-remote', 'remote', 'config', 'describe',
    'shortlog', 'reflog', 'grep', 'log', 'whatchanged', 'cherry', 'format-patch',
    'for-each-ref', 'name-rev', 'cat-file', 'diff-tree', 'diff-files', 'diff-index',
    'check-attr', 'check-ignore', 'check-ref-format', 'count-objects', 'fsck',
    'gc', 'help', 'notes', 'show-ref', 'verify-commit', 'verify-tag',
    'range-diff',
  ]),
  npm: new Set(['ls', 'list', 'view', 'info', 'search', 'outdated', 'config', 'root',
    'bin', 'prefix', 'version', 'help', 'docs', 'bugs', 'repo', 'audit']),
  pnpm: new Set(['list', 'ls', 'view', 'outdated', 'audit', 'why', 'help']),
  yarn: new Set(['list', 'info', 'outdated', 'why', 'help', 'version']),
  cargo: new Set(['check', 'build', 'test', 'bench', 'doc', 'metadata', 'tree', 'version',
    'help', 'search', 'readme', 'config']),
  docker: new Set(['ps', 'images', 'inspect', 'logs', 'stats', 'info', 'version',
    'history', 'diff', 'top', 'search', 'events', 'context', 'help']),
  kubectl: new Set(['get', 'describe', 'logs', 'top', 'explain', 'version', 'api-versions',
    'cluster-info', 'config', 'auth', 'help']),
  helm: new Set(['list', 'ls', 'status', 'show', 'history', 'get', 'search', 'repo',
    'env', 'help', 'version']),
  pip: new Set(['list', 'show', 'search', 'freeze', 'check', 'config', 'help', 'inspect']),
  brew: new Set(['list', 'ls', 'info', 'search', 'config', 'outdated', 'leaves', 'deps',
    'uses', 'help', 'doctor', 'analytics', 'pin', 'bundle', 'commands', 'tests',
    'livecheck', 'linkage', 'readall', 'update-reset', 'vendor-install']),
};

/** Patterns that indicate a command has side effects (writes, deletes, network mutations). */
const DANGEROUS_PATTERNS: RegExp[] = [
  // Redirections that write
  />\s*\S/, />>/, /<</,
  // Destructive filesystem
  /\brm\b/, /\bmv\b/, /\bcp\b/, /\bmkdir\b/, /\brmdir\b/, /\btouch\b/,
  /\bdd\b/, /\bln\s+-[sf]/,
  // Permissions / ownership
  /\bchmod\b/, /\bchown\b/, /\bchgrp\b/, /\bsudo\b/, /\bsu\b/,
  // Process control
  /\bkill\b/, /\bkillall\b/, /\bpkill\b/, /\bshutdown\b/, /\breboot\b/,
  /\bhalt\b/, /\bpoweroff\b/,
  // Mount
  /\bmount\b/, /\bumount\b/, /\bfsck\b/, /\bmkfs\b/,
  // Network mutations
  /\bcurl\b(?!.*(--head|-I|-X\s*GET\b))/i,  /\bwget\b/i,
  /\bscp\b/, /\brsync\b/, /\bnc\s+-[^h]/,
  // Package install / uninstall
  /\b(npm|pnpm|yarn)\s+(install|i|add|uninstall|remove|update|upgrade|up|link|unlink|publish)\b/,
  /\b(pip|pip3)\s+install\b/,
  /\b(gem|composer)\s+install\b/,
  /\bbrew\s+(install|uninstall|upgrade|update|link|unlink|tap|untap|cleanup|prune)\b/,
  /\bcargo\s+(install|uninstall|update|publish|add|remove|fix|clippy)\b/,
  // Git mutations (not already covered by subcommand allowlist)
  /\bgit\s+(commit|push|merge|rebase|checkout|reset|add|rm|mv|tag\s+-d|branch\s+-[dD]|clean|gc|prune|stash\s+(push|save|drop|clear|pop|apply)|config\s+(--add|--unset|--replace-all))\b/,
  // Docker mutations
  /\bdocker\s+(run|start|stop|restart|rm|rmi|build|push|pull|tag|exec|commit|create|rename|update|kill|pause|unpause|cp|export|import|load|save|login|logout|trust|swarm)\b/,
  // kubectl mutations
  /\bkubectl\s+(apply|create|delete|edit|patch|replace|scale|expose|run|set|label|annotate|rollout|drain|cordon|uncordon|taint)\b/,
];

/** Write-like npm/pnpm/yarn sub-commands */
const INSTALL_SUBCOMMANDS = new Set([
  'install', 'i', 'add', 'uninstall', 'remove', 'update', 'upgrade', 'up',
  'link', 'unlink', 'publish', 'audit', 'fix', 'rebuild',
]);

const isKnownInstallSub = (cmd: string | undefined): boolean =>
  typeof cmd === 'string' && INSTALL_SUBCOMMANDS.has(cmd.trim());

const isShellCommandReadonly = (rawCommand: string): boolean => {
  const trimmed = rawCommand.trim();
  if (!trimmed) return false;

  // Check for dangerous patterns first (they win over readonly base commands)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Split on &&, ;, ||, |, newlines — each segment is checked independently
  const segments = trimmed.split(SPLIT_PATTERN);
  for (const segment of segments) {
    if (!segment.trim()) continue;
    const tokens = segment.trim().split(/\s+/);
    if (tokens.length === 0) continue;

    const baseCommand = tokens[0].replace(/^.*\//, ''); // strip path prefix
    const subCommand = tokens[1];

    // Check subcommand allowlist first (git log, npm list, etc.)
    const subAllowlist = READONLY_SUBCOMMANDS[baseCommand];
    if (subAllowlist) {
      if (subCommand && subAllowlist.has(subCommand)) continue;
      // Known binary with a subcommand not in the allowlist → potentially dangerous
      if (subCommand && !subAllowlist.has(subCommand)) {
        // Some subcommands we explicitly block via DANGEROUS_PATTERNS (already checked above)
        // For others not in either list, default to unsafe
        if (!isKnownInstallSub(subCommand)) return false;
      }
      if (!subCommand) {
        // Bare 'git', 'npm', etc. with no subcommand — likely read-only (help, version)
        continue;
      }
    }

    // Version check: `node -v`, `python --version`, `npm list`, etc.
    if (READONLY_COMMANDS.has(baseCommand)) continue;

    // Unknown command — fail safe (needs approval)
    return false;
  }

  return true;
};

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
  override needsApproval = (args: z.infer<typeof ShellToolInputSchema>) =>
    !isShellCommandReadonly(args.command);
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
