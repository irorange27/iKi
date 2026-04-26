import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getVisibleWorkspacesMock,
  getWorkspaceMock,
  getWorkspaceByPathMock,
  addWorkspaceMock,
  updateWorkspaceMock,
  getChatThreadMock,
  updateChatThreadMock,
} = vi.hoisted(() => ({
  getVisibleWorkspacesMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getWorkspaceByPathMock: vi.fn(),
  addWorkspaceMock: vi.fn(),
  updateWorkspaceMock: vi.fn(),
  getChatThreadMock: vi.fn(),
  updateChatThreadMock: vi.fn(),
}));

vi.mock('../../../src/core/db/workspaces', () => ({
  getVisibleWorkspaces: getVisibleWorkspacesMock,
  getWorkspace: getWorkspaceMock,
  getWorkspaceByPath: getWorkspaceByPathMock,
  addWorkspace: addWorkspaceMock,
  updateWorkspace: updateWorkspaceMock,
}));

vi.mock('../../../src/core/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
  updateChatThread: updateChatThreadMock,
}));

import {
  DeleteFileTool,
  EditFileTool,
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

const runInWorkspaceContext = async <T>(threadId: string, fn: () => Promise<T>): Promise<T> =>
  await runWithToolRuntimeContext({ threadId }, fn);

const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

describe('file tools workspace boundaries', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    getChatThreadMock.mockReturnValue(null);
    getWorkspaceByPathMock.mockReturnValue(null);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-file-tools-'));
    process.env.IKI_USER_DATA_PATH = path.join(tempRoot, 'user-data');
  });

  afterEach(async () => {
    delete process.env.IKI_USER_DATA_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('reads a file inside the configured workspace', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'note.txt'), 'hello workspace', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new ReadFileTool();
    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({ path: 'docs/note.txt' })
    )) as { path: string; content: string };

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
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new ReadFileTool();

    await expect(
      runInWorkspaceContext('thread_1', async () => tool.execute({ path: 'shared/secret.txt' }))
    ).rejects.toThrow(/outside workspace roots/i);
  });

  it('rejects writes that escape through a symlinked directory', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const outsideRoot = path.join(tempRoot, 'outside');
    const outsideFile = path.join(outsideRoot, 'created.txt');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'shared'), symlinkType);
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new WriteFileTool();

    await expect(
      runInWorkspaceContext('thread_1', async () =>
        tool.execute({
          path: 'shared/created.txt',
          content: 'nope',
        })
      )
    ).rejects.toThrow(/outside workspace roots/i);

    await expect(fs.access(outsideFile)).rejects.toThrow();
  });

  it('publishes auto-mode metadata for all file tools by default', () => {
    expect(new ListDirTool().toAgentTool().autoAllowed).toBe(true);
    expect(new ReadFileTool().toAgentTool().autoAllowed).toBe(true);
    expect(new EditFileTool().toAgentTool().autoAllowed).toBe(true);
    expect(new WriteFileTool().toAgentTool().autoAllowed).toBe(true);
    expect(new DeleteFileTool().toAgentTool().autoAllowed).toBe(true);
  });

  it('edits an existing file through exact text replacement', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const filePath = path.join(workspaceRoot, 'docs', 'note.txt');
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(filePath, 'hello workspace\nsecond line\n', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new EditFileTool();
    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({
        path: 'docs/note.txt',
        edits: [{ oldText: 'hello workspace', newText: 'hello edited workspace' }],
      })
    )) as {
      path: string;
      success: boolean;
      changed: boolean;
      appliedEditCount: number;
      totalReplacements: number;
    };

    expect(result).toMatchObject({
      path: filePath,
      success: true,
      changed: true,
      appliedEditCount: 1,
      totalReplacements: 1,
    });
    expect(typeof (result as Record<string, unknown>).diff).toBe('string');
    expect(await fs.readFile(filePath, 'utf8')).toBe('hello edited workspace\nsecond line\n');
  });

  it('rejects ambiguous edits unless replaceAll is explicit', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'repeated.txt'), 'alpha\nbeta\nalpha\n', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new EditFileTool();

    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({
        path: 'repeated.txt',
        edits: [{ oldText: 'alpha', newText: 'gamma' }],
      })
    )) as { success: boolean; error: boolean; message: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe(true);
    expect(result.message).toMatch(/matched 2 locations/i);
  });

  it('supports replaceAll edits when the caller explicitly requests them', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const filePath = path.join(workspaceRoot, 'repeated.txt');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.writeFile(filePath, 'alpha\nbeta\nalpha\n', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new EditFileTool();
    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({
        path: 'repeated.txt',
        edits: [{ oldText: 'alpha', newText: 'gamma', replaceAll: true }],
      })
    )) as {
      changed: boolean;
      totalReplacements: number;
    };

    expect(result.changed).toBe(true);
    expect(result.totalReplacements).toBe(2);
    expect(await fs.readFile(filePath, 'utf8')).toBe('gamma\nbeta\ngamma\n');
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
    const result = await runInWorkspaceContext('thread_1', async () =>
      tool.execute({ path: 'docs/note.txt' })
    );

    expect((result as { content: string }).content).toBe('secondary only');
  });

  it('auto-creates a temporary workspace when the active thread points to a missing workspace record', async () => {
    const tempWorkspaceRoot = path.join(
      process.env.IKI_USER_DATA_PATH as string,
      'thread-workspaces',
      'thread_1'
    );
    const tempWorkspaceId = 'workspace_thread_thread_1';
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_missing',
      title: 'Recovered thread',
    });
    getWorkspaceMock.mockImplementation((id: string) =>
      id === tempWorkspaceId
        ? {
            id,
            path: tempWorkspaceRoot,
            name: 'Recovered thread Scratch',
            is_temporary: 1,
            show_in_list: 0,
          }
        : null
    );

    const tool = new WriteFileTool();
    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({
        path: 'note.txt',
        content: 'hello temp workspace',
      })
    )) as { path: string; success: boolean };

    expect(result.success).toBe(true);
    expect(result.path).toBe(path.join(tempWorkspaceRoot, 'note.txt'));
    expect(addWorkspaceMock).toHaveBeenCalledWith({
      id: tempWorkspaceId,
      path: tempWorkspaceRoot,
      name: 'Recovered thread Scratch',
      is_temporary: 1,
      show_in_list: 0,
    });
    expect(updateChatThreadMock).toHaveBeenCalledWith('thread_1', {
      workspace_id: tempWorkspaceId,
    });
  });

  it('auto-creates a temporary workspace when no workspace is selected for the active thread', async () => {
    const tempWorkspaceRoot = path.join(
      process.env.IKI_USER_DATA_PATH as string,
      'thread-workspaces',
      'thread_1'
    );
    const tempWorkspaceId = 'workspace_thread_thread_1';
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: null,
      title: 'Ad hoc thread',
    });
    getWorkspaceMock.mockImplementation((id: string) =>
      id === tempWorkspaceId
        ? {
            id,
            path: tempWorkspaceRoot,
            name: 'Ad hoc thread Scratch',
            is_temporary: 1,
            show_in_list: 0,
          }
        : null
    );

    const tool = new WriteFileTool();
    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({
        path: 'scratch.txt',
        content: 'auto workspace',
      })
    )) as { path: string; success: boolean };

    expect(result.success).toBe(true);
    expect(result.path).toBe(path.join(tempWorkspaceRoot, 'scratch.txt'));
    expect(updateChatThreadMock).toHaveBeenCalledWith('thread_1', {
      workspace_id: tempWorkspaceId,
    });
  });

  it('allows writes into the app brain folder through the brain/ alias', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const tool = new WriteFileTool();
    const result = (await runInWorkspaceContext('thread_1', async () =>
      tool.execute({
        path: 'brain/owner.md',
        content: '# Owner\n\n- Preferred name: Nina\n',
      })
    )) as { path: string; success: boolean };

    expect(result.success).toBe(true);
    expect(result.path).toBe(
      path.join(process.env.IKI_USER_DATA_PATH as string, 'brain', 'owner.md')
    );
    expect(
      await fs.readFile(
        path.join(process.env.IKI_USER_DATA_PATH as string, 'brain', 'owner.md'),
        'utf8'
      )
    ).toContain('Preferred name: Nina');
  });
});
