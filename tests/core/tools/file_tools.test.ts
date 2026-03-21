import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getVisibleWorkspacesMock, getWorkspaceMock, getChatThreadMock } = vi.hoisted(() => ({
  getVisibleWorkspacesMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getChatThreadMock: vi.fn(),
}));

vi.mock('../../../src/core/db/workspaces', () => ({
  getVisibleWorkspaces: getVisibleWorkspacesMock,
  getWorkspace: getWorkspaceMock,
}));

vi.mock('../../../src/core/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
}));

import {
  DeleteFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from '../../../src/core/tools/file_tools';
import { runWithToolRuntimeContext } from '../../../src/core/tools/runtime_context';

const createWorkspace = (workspacePath: string) => ({
  id: 'workspace_1',
  path: workspacePath,
  name: 'workspace',
  is_temporary: 0,
  show_in_list: 1,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

describe('file tools workspace boundaries', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    getChatThreadMock.mockReturnValue(null);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-file-tools-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('reads a file inside the configured workspace', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'note.txt'), 'hello workspace', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);

    const tool = new ReadFileTool();
    const result = (await tool.execute({ path: 'docs/note.txt' })) as {
      path: string;
      content: string;
    };

    expect(result.path).toBe(path.join(workspaceRoot, 'docs', 'note.txt'));
    expect(result.content).toBe('hello workspace');
  });

  it('rejects reads that escape through a symlinked directory', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const outsideRoot = path.join(tempRoot, 'outside');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'outside', 'utf8');
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'shared'), symlinkType);
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);

    const tool = new ReadFileTool();

    await expect(tool.execute({ path: 'shared/secret.txt' })).rejects.toThrow(
      /outside workspace roots/i
    );
  });

  it('rejects writes that escape through a symlinked directory', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const outsideRoot = path.join(tempRoot, 'outside');
    const outsideFile = path.join(outsideRoot, 'created.txt');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'shared'), symlinkType);
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);

    const tool = new WriteFileTool();

    await expect(
      tool.execute({
        path: 'shared/created.txt',
        content: 'nope',
      })
    ).rejects.toThrow(/outside workspace roots/i);

    await expect(fs.access(outsideFile)).rejects.toThrow();
  });

  it('publishes auto-mode metadata for all file tools by default', () => {
    expect(new ListDirTool().toAgentTool().autoAllowed).toBe(true);
    expect(new ReadFileTool().toAgentTool().autoAllowed).toBe(true);
    expect(new WriteFileTool().toAgentTool().autoAllowed).toBe(true);
    expect(new DeleteFileTool().toAgentTool().autoAllowed).toBe(true);
  });

  it('pins relative reads to the active thread workspace when one is selected', async () => {
    const primaryWorkspace = path.join(tempRoot, 'primary');
    const secondaryWorkspace = path.join(tempRoot, 'secondary');
    await fs.mkdir(path.join(primaryWorkspace, 'docs'), { recursive: true });
    await fs.mkdir(path.join(secondaryWorkspace, 'docs'), { recursive: true });
    await fs.writeFile(path.join(primaryWorkspace, 'docs', 'note.txt'), 'primary only', 'utf8');
    await fs.writeFile(path.join(secondaryWorkspace, 'docs', 'note.txt'), 'secondary only', 'utf8');

    getVisibleWorkspacesMock.mockReturnValue([
      createWorkspace(primaryWorkspace),
      { ...createWorkspace(secondaryWorkspace), id: 'workspace_2', name: 'secondary' },
    ]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_2',
    });
    getWorkspaceMock.mockReturnValue({
      ...createWorkspace(secondaryWorkspace),
      id: 'workspace_2',
      name: 'secondary',
      show_in_list: 0,
    });

    const tool = new ReadFileTool();
    const result = await runWithToolRuntimeContext({ threadId: 'thread_1' }, async () =>
      tool.execute({ path: 'docs/note.txt' })
    );

    expect((result as { content: string }).content).toBe('secondary only');
  });

  it('fails closed when the active thread points to a missing workspace record', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'note.txt'), 'hello workspace', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_missing',
    });
    getWorkspaceMock.mockReturnValue(null);

    const tool = new ReadFileTool();

    await expect(
      runWithToolRuntimeContext({ threadId: 'thread_1' }, async () =>
        tool.execute({ path: 'docs/note.txt' })
      )
    ).rejects.toThrow(/selected workspace "workspace_missing" is unavailable/i);
  });
});
