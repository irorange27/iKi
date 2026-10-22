import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userDataMock = vi.hoisted(() => vi.fn(() => ''));
vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));

import {
  resolveDeleteWorkspacePath,
  resolveReadableWorkspacePath,
  resolveWritableWorkspacePath,
} from '@iki/backend/tools/workspace_paths';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

const contextFor = (root: string) =>
  ({
    threadId: 'thread_ws',
    workspaceSelectionBox: {
      selection: { threadId: 'thread_ws', workspaceId: 'ws', workspace: { id: 'ws', name: 'ws', path: root } },
    },
  }) as never;

describe('workspace path resolvers return the validated path', () => {
  let root = '';
  let userData = '';
  let outside = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-ws-'));
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-ud-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-out-'));
    userDataMock.mockReturnValue(userData);
  });

  afterEach(async () => {
    for (const dir of [root, userData, outside]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('readable: validated is the realpath, display is the caller spelling', async () => {
    await fs.writeFile(path.join(root, 'inside.txt'), 'inside body');
    await fs.symlink(path.join(root, 'inside.txt'), path.join(root, 'link.txt'));

    const resolved = await runWithToolRuntimeContext(contextFor(root), () =>
      resolveReadableWorkspacePath('link.txt')
    );

    expect(resolved.validated).toBe(await fs.realpath(resolved.validated));
    expect(resolved.validated).toBe(path.join(await fs.realpath(root), 'inside.txt'));
    expect(resolved.display).toBe(path.join(root, 'link.txt'));
  });

  it('readable: refuses a link that points outside the workspace', async () => {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));

    await expect(
      runWithToolRuntimeContext(contextFor(root), () => resolveReadableWorkspacePath('escape.txt'))
    ).rejects.toThrow(/outside/i);
  });

  it('writable: an existing symlinked target resolves to its real file', async () => {
    await fs.writeFile(path.join(root, 'target.txt'), 'original');
    await fs.symlink(path.join(root, 'target.txt'), path.join(root, 'alias.txt'));

    const resolved = await runWithToolRuntimeContext(contextFor(root), () =>
      resolveWritableWorkspacePath('alias.txt')
    );

    expect(resolved.validated).toBe(path.join(await fs.realpath(root), 'target.txt'));
    expect(resolved.display).toBe(path.join(root, 'alias.txt'));
  });

  it('writable: a new file sits under its validated real ancestor', async () => {
    const resolved = await runWithToolRuntimeContext(contextFor(root), () =>
      resolveWritableWorkspacePath('nested/new.txt')
    );

    const realRoot = await fs.realpath(root);
    expect(resolved.validated).toBe(path.join(realRoot, 'nested/new.txt'));
    expect(path.dirname(resolved.validated)).toBe(path.join(realRoot, 'nested'));
    expect(resolved.display).toBe(path.join(root, 'nested/new.txt'));
  });

  it('writable: writing through a symlinked file targets the validated path', async () => {
    await fs.writeFile(path.join(root, 'real.txt'), 'original');
    await fs.symlink(path.join(root, 'real.txt'), path.join(root, 'alias.txt'));

    const resolved = await runWithToolRuntimeContext(contextFor(root), () =>
      resolveWritableWorkspacePath('alias.txt')
    );

    expect(resolved.validated).not.toBe(resolved.display);
    expect(resolved.validated).toBe(path.join(await fs.realpath(root), 'real.txt'));
  });
  it('delete: resolves under its validated real parent', async () => {
    await fs.mkdir(path.join(root, 'dir'));
    await fs.writeFile(path.join(root, 'dir', 'file.txt'), 'x');

    const resolved = await runWithToolRuntimeContext(contextFor(root), () =>
      resolveDeleteWorkspacePath('dir/file.txt')
    );

    expect(resolved.validated).toBe(path.join(await fs.realpath(root), 'dir', 'file.txt'));
    expect(resolved.display).toBe(path.join(root, 'dir/file.txt'));
  });
});
