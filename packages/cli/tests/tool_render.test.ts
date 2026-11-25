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

  it('renders swarm tool completion cards cleanly instead of raw JSON', () => {
    const added = formatToolCallCompleted({
      toolName: 'swarm',
      input: { action: 'add', name: 'builder', workspace: 'share', brief: 'Add slugify' },
      output: {
        type: 'json',
        value: {
          swarmId: 'swarm_demo',
          spawned: [
            { name: 'builder', workspaceMode: 'share', branch: 'iki/swarm/demo/builder', model: 'm1' },
          ],
        },
      },
      elapsedMs: 120,
    });
    const addedPlain = stripAnsi(added.text);
    expect(added.tone).toBe('success');
    expect(addedPlain).toContain('+ @builder');
    expect(addedPlain).toContain('iki/swarm/demo/builder');
    expect(addedPlain).not.toContain('"spawned"');

    const posted = formatToolCallCompleted({
      toolName: 'swarm',
      input: { action: 'post', message: '@auditor check stats.js' },
      output: { type: 'json', value: { swarmId: 'swarm_demo', seq: 5, woken: ['auditor'] } },
    });
    expect(stripAnsi(posted.text)).toContain('Posted #5 (woke @auditor)');
  });

  it('renders ptc and mcp tool cards with call traces and readable headers', () => {
    const ptcPending = stripAnsi(
      formatToolCallPending('ptc', {
        language: 'ts',
        description: 'Batch compute',
        code: 'const x = await tools.mcp_calc_add({ a: 1, b: 2 });\nreturn x;',
      })
    );
    expect(ptcPending).toContain('ptc (ts)');
    expect(ptcPending).toContain('Batch compute');

    const ptcDone = formatToolCallCompleted({
      toolName: 'ptc',
      input: { language: 'ts', code: 'return 42;' },
      output: {
        type: 'json',
        value: {
          ok: true,
          result: { total: 42 },
          logs: ['computed'],
          toolCalls: [{ name: 'mcp_calc_add', durationMs: 9, ok: true }],
          toolCallCount: 1,
          durationMs: 18,
          truncated: false,
        },
      },
    });
    const ptcPlain = stripAnsi(ptcDone.text);
    expect(ptcDone.tone).toBe('success');
    expect(ptcPlain).toContain('calls: ✓mcp_calc_add(9ms)');
    expect(ptcPlain).toContain('18ms · 1 call');

    const mcpPending = stripAnsi(formatToolCallPending('mcp_calc_add', { a: 1, b: 2 }));
    expect(mcpPending).toContain('mcp calc/add');
  });
});
