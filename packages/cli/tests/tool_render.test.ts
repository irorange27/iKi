import { describe, expect, it } from 'vitest';
import {
  formatToolCallCompleted,
  formatToolCallError,
  formatToolCallPending,
} from '../src/tool_render';

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = (value: string): string => value.replace(ANSI_RE, '');

describe('CLI tool TUI rendering', () => {
  it('renders bash command args cleanly instead of raw JSON', () => {
    const pending = stripAnsi(
      formatToolCallPending('bash', {
        command: 'echo hello\necho world',
        cwd: '/tmp/demo',
        timeout: 120_000,
        description: 'Print greeting lines',
      })
    );

    expect(pending).toContain('$ echo hello');
    expect(pending).toContain('echo world');
    expect(pending).toContain('cwd: /tmp/demo');
    expect(pending).toContain('timeout 120s');
    expect(pending).toContain('Print greeting lines');
    expect(pending).not.toContain('{"command"');
  });

  it('renders pwsh prompt prefix and completed output tail preview', () => {
    const outputLines = Array.from({ length: 10 }, (_, i) => `out-${i + 1}`).join('\n');
    const completed = formatToolCallCompleted({
      toolName: 'pwsh',
      input: { command: 'Get-ChildItem' },
      output: { type: 'json', value: { stdout: outputLines, exitCode: 0, durationMs: 420 } },
    });

    const plain = stripAnsi(completed.text);
    expect(completed.tone).toBe('success');
    expect(plain).toContain('PS> Get-ChildItem');
    expect(plain).toContain('... (4 earlier lines)');
    expect(plain).toContain('out-10');
    expect(plain).toContain('[exit 0 · 420ms]');
  });

  it('renders background promoted shell jobs and error states distinctly', () => {
    const bg = formatToolCallCompleted({
      toolName: 'bash',
      input: { command: 'pnpm build', background: true },
      output: {
        type: 'json',
        value: {
          backgrounded: true,
          jobId: 'job_1234abcd',
          pid: 4242,
          logPath: '/tmp/job_1234abcd.log',
          stdout: 'compiling...',
          durationMs: 30000,
        },
      },
    });
    expect(bg.tone).toBe('background');
    expect(stripAnsi(bg.text)).toContain('background job_1234abcd');
    expect(stripAnsi(bg.text)).toContain('compiling...');

    const err = stripAnsi(
      formatToolCallError({
        toolName: 'bash',
        input: { command: 'false' },
        errorText: 'Command failed',
      })
    );
    expect(err).toContain('$ false');
    expect(err).toContain('Command failed');
  });
});
