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

vi.mock('@iki/backend/db/workspaces', () => ({
  getVisibleWorkspaces: getVisibleWorkspacesMock,
  getWorkspace: getWorkspaceMock,
  getWorkspaceByPath: getWorkspaceByPathMock,
  addWorkspace: addWorkspaceMock,
  updateWorkspace: updateWorkspaceMock,
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
  updateChatThread: updateChatThreadMock,
}));

import {
  DeleteFileTool,
  EditFileTool,
  ReadFileTool,
  UndoEditTool,
  WriteFileTool,
} from '@iki/backend/tools/file_tools';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

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

  it('reads current content after external and tool writes', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const filePath = path.join(workspaceRoot, 'docs', 'note.txt');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'first', 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const reader = new ReadFileTool();
    const writer = new WriteFileTool();

    const first = (await runInWorkspaceContext('thread_1', async () =>
      reader.execute({ path: 'docs/note.txt' })
    )) as { content: string };
    await fs.writeFile(filePath, 'external', 'utf8');
    const cached = (await runInWorkspaceContext('thread_1', async () =>
      reader.execute({ path: 'docs/note.txt' })
    )) as { content: string };

    await runInWorkspaceContext('thread_1', async () =>
      writer.execute({ path: 'docs/note.txt', content: 'via tool' })
    );
    const refreshed = (await runInWorkspaceContext('thread_1', async () =>
      reader.execute({ path: 'docs/note.txt' })
    )) as { content: string };

    expect(first.content).toBe('first');
    expect(cached.content).toBe('external');
    expect(refreshed.content).toBe('via tool');
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

  it.each(['link.txt', 'link/nested.txt'])('rejects writes through dangling symlinks: %s', async input => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const outsideRoot = path.join(tempRoot, 'outside');
    await fs.mkdir(workspaceRoot);
    await fs.mkdir(outsideRoot);
    const target = path.join(outsideRoot, 'missing');
    await fs.symlink(target, path.join(workspaceRoot, input.split('/')[0]));
    getChatThreadMock.mockReturnValue({ id: 'thread_1', workspace_id: 'workspace_1' });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    await expect(runInWorkspaceContext('thread_1', () =>
      new WriteFileTool().execute({ path: input, content: 'escaped' })
    )).rejects.toThrow(/dangling symbolic link/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it('creates missing nested directories inside the workspace', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspaceRoot);
    getChatThreadMock.mockReturnValue({ id: 'thread_1', workspace_id: 'workspace_1' });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));
    await runInWorkspaceContext('thread_1', () => new WriteFileTool().execute({ path: 'new/nested/file.txt', content: 'inside' }));
    expect(await fs.readFile(path.join(workspaceRoot, 'new/nested/file.txt'), 'utf8')).toBe('inside');
  });

  it('checks cancellation again after asynchronous path resolution', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspaceRoot);
    const controller = new AbortController();
    getChatThreadMock.mockReturnValue({ id: 'thread_1', workspace_id: 'workspace_1' });
    getWorkspaceMock.mockImplementation(() => {
      controller.abort(new Error('stop before write'));
      return createWorkspace(workspaceRoot);
    });
    await expect(runWithToolRuntimeContext({ threadId: 'thread_1', abortSignal: controller.signal }, () =>
      new WriteFileTool().execute({ path: 'new/file.txt', content: 'unwanted' })
    )).rejects.toThrow('stop before write');
    await expect(fs.access(path.join(workspaceRoot, 'new'))).rejects.toThrow();
  });

  it('does not begin file mutations after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by user'));
    await expect(runWithToolRuntimeContext({ threadId: 'thread_1', abortSignal: controller.signal }, () =>
      new WriteFileTool().execute({ path: 'new.txt', content: 'unwanted' })
    )).rejects.toThrow('cancelled by user');
    expect(getWorkspaceMock).not.toHaveBeenCalled();
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

  it('keeps working directories isolated across interleaved tool contexts', async () => {
    const roots = [path.join(tempRoot, 'a'), path.join(tempRoot, 'b')];
    await Promise.all(roots.map(root => fs.mkdir(root)));
    getChatThreadMock.mockImplementation(id => ({ id, workspace_id: id }));
    getWorkspaceMock.mockImplementation(id => ({ ...createWorkspace(roots[id === 'a' ? 0 : 1]), id }));
    const values = await Promise.all(['a', 'b'].map(id => runInWorkspaceContext(id, async () => {
      await new WriteFileTool().execute({ path: 'same.txt', content: id });
      await Promise.resolve();
      return new ReadFileTool().execute({ path: 'same.txt' });
    })));
    expect(values).toMatchObject([{ content: 'a' }, { content: 'b' }]);
    expect(await fs.readFile(path.join(roots[0], 'same.txt'), 'utf8')).toBe('a');
    expect(await fs.readFile(path.join(roots[1], 'same.txt'), 'utf8')).toBe('b');
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

  it('auto-creates a temporary workspace for work threads with no workspace selected', async () => {
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
      metadata: '{"mode":"work"}',
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

describe('edit_file lint gate and undo', () => {
  let lintTempRoot = '';

  beforeEach(async () => {
    lintTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-file-tools-lint-'));
  });

  afterEach(async () => {
    await fs.rm(lintTempRoot, { recursive: true, force: true });
  });

  const setupWorkspace = async (fileName: string, content: string) => {
    const workspaceRoot = path.join(lintTempRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    const filePath = path.join(workspaceRoot, fileName);
    await fs.writeFile(filePath, content, 'utf8');
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({
      id: 'thread_1',
      workspace_id: 'workspace_1',
    });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));
    return { workspaceRoot, filePath };
  };

  it('rejects edits that would break JSON syntax and leaves the file untouched', async () => {
    const original = '{\n  "name": "demo"\n}\n';
    const { filePath } = await setupWorkspace('config.json', original);

    const result = (await runInWorkspaceContext('thread_1', async () =>
      new EditFileTool().execute({
        path: 'config.json',
        edits: [{ oldText: '"name": "demo"', newText: '"name": "demo",, "broken": tru' }],
      })
    )) as { success: boolean; error: boolean; message: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe(true);
    expect(result.message).toContain('syntax check failed');
    expect(await fs.readFile(filePath, 'utf8')).toBe(original);
  });

  it('does not block edits to file types without a syntax checker', async () => {
    const { filePath } = await setupWorkspace('note.txt', 'hello\n');

    const result = (await runInWorkspaceContext('thread_1', async () =>
      new EditFileTool().execute({
        path: 'note.txt',
        edits: [{ oldText: 'hello', newText: 'hello edited' }],
      })
    )) as { success: boolean; syntaxCheck?: string };

    expect(result.success).toBe(true);
    expect(result.syntaxCheck).toBe('skipped');
    expect(await fs.readFile(filePath, 'utf8')).toBe('hello edited\n');
  });

  it('reverts the most recent edit via undo_edit', async () => {
    const { filePath } = await setupWorkspace('app.js', 'const value = 1;\n');

    const editResult = (await runInWorkspaceContext('thread_1', async () =>
      new EditFileTool().execute({
        path: 'app.js',
        edits: [{ oldText: 'const value = 1;', newText: 'const value = 2;' }],
      })
    )) as { success: boolean };
    expect(editResult.success).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe('const value = 2;\n');

    const undoResult = (await runInWorkspaceContext('thread_1', async () =>
      new UndoEditTool().execute({ path: 'app.js' })
    )) as { success: boolean; restored: boolean; editsRemaining: number };

    expect(undoResult).toMatchObject({ success: true, restored: true, editsRemaining: 0 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('const value = 1;\n');

    const secondUndo = (await runInWorkspaceContext('thread_1', async () =>
      new UndoEditTool().execute({ path: 'app.js' })
    )) as { success: boolean; error: boolean };

    expect(secondUndo.success).toBe(false);
    expect(secondUndo.error).toBe(true);
  });

  it('isolates undo by thread and refuses to overwrite another edit', async () => {
    const { filePath } = await setupWorkspace('shared.txt', 'original');
    await runInWorkspaceContext('thread_1', () => new EditFileTool().execute({
      path: 'shared.txt', edits: [{ oldText: 'original', newText: 'first' }],
    }));
    const otherUndo = await runInWorkspaceContext('thread_2', () => new UndoEditTool().execute({ path: 'shared.txt' }));
    expect(otherUndo).toMatchObject({ success: false });
    expect(await fs.readFile(filePath, 'utf8')).toBe('first');
    await fs.writeFile(filePath, 'newer change');
    const ownUndo = await runInWorkspaceContext('thread_1', () => new UndoEditTool().execute({ path: 'shared.txt' }));
    expect(ownUndo).toMatchObject({ success: false, message: expect.stringContaining('File changed') });
    expect(await fs.readFile(filePath, 'utf8')).toBe('newer change');
  });

  it('undoes sequential edits step by step', async () => {
    const { filePath } = await setupWorkspace('steps.py', 'value = 1\n');

    for (const next of ['2', '3']) {
      await runInWorkspaceContext('thread_1', async () =>
        new EditFileTool().execute({
          path: 'steps.py',
          edits: [{ oldText: `value = ${next === '2' ? '1' : '2'}`, newText: `value = ${next}` }],
        })
      );
    }
    expect(await fs.readFile(filePath, 'utf8')).toBe('value = 3\n');

    await runInWorkspaceContext('thread_1', async () => new UndoEditTool().execute({ path: 'steps.py' }));
    expect(await fs.readFile(filePath, 'utf8')).toBe('value = 2\n');

    await runInWorkspaceContext('thread_1', async () => new UndoEditTool().execute({ path: 'steps.py' }));
    expect(await fs.readFile(filePath, 'utf8')).toBe('value = 1\n');
  });
});

describe('atomic file writes', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    getChatThreadMock.mockReturnValue(null);
    getWorkspaceByPathMock.mockReturnValue(null);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-file-atomic-'));
    process.env.IKI_USER_DATA_PATH = path.join(tempRoot, 'user-data');
  });

  afterEach(async () => {
    delete process.env.IKI_USER_DATA_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('leaves no temp artifacts and stores full content', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({ id: 'thread_1', workspace_id: 'workspace_1' });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));

    const writer = new WriteFileTool();
    await runInWorkspaceContext('thread_1', async () => {
      await writer.execute({ path: 'atomic.txt', content: 'full-content'.repeat(100) });
    });

    expect(await fs.readFile(path.join(workspaceRoot, 'atomic.txt'), 'utf8')).toBe(
      'full-content'.repeat(100)
    );
    const leftovers = (await fs.readdir(workspaceRoot)).filter(name => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});

describe('concurrent same-path writes', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    getChatThreadMock.mockReturnValue(null);
    getWorkspaceByPathMock.mockReturnValue(null);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-file-concurrent-'));
    process.env.IKI_USER_DATA_PATH = path.join(tempRoot, 'user-data');
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z'), shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.IKI_USER_DATA_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const setupWorkspace = async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspaceRoot, { recursive: true });
    getVisibleWorkspacesMock.mockReturnValue([createWorkspace(workspaceRoot)]);
    getChatThreadMock.mockReturnValue({ id: 'thread_1', workspace_id: 'workspace_1' });
    getWorkspaceMock.mockReturnValue(createWorkspace(workspaceRoot));
    return workspaceRoot;
  };

  it('keeps same-millisecond concurrent writes to one path atomic with unique temp files', async () => {
    const workspaceRoot = await setupWorkspace();
    const writer = new WriteFileTool();

    // Fake clock pins Date.now: pid+timestamp temp names would collide here.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runInWorkspaceContext('thread_1', () =>
          writer.execute({ path: 'shared.txt', content: `writer-${i}-` .repeat(200) })
        )
      )
    );

    for (const result of results) {
      expect((result as { success: boolean }).success).toBe(true);
    }
    const finalContent = await fs.readFile(path.join(workspaceRoot, 'shared.txt'), 'utf8');
    expect(finalContent).toMatch(/^writer-\d+-/);
    const leftovers = (await fs.readdir(workspaceRoot)).filter(name => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('serializes concurrent edits so every applied edit is based on the previous write', async () => {
    const workspaceRoot = await setupWorkspace();
    await fs.writeFile(path.join(workspaceRoot, 'log.txt'), 'start\n', 'utf8');

    const editor = new EditFileTool();
    const edits = Array.from({ length: 6 }, (_, i) =>
      runInWorkspaceContext('thread_1', () =>
        editor.execute({
          path: 'log.txt',
          edits: [{ oldText: 'start', newText: `start line-${i}` }],
        })
      )
    );

    const results = (await Promise.all(edits)) as Array<{ success?: boolean; message?: string }>;
    // Without per-path serialization only the first edit could match; with it,
    // each subsequent edit runs after the previous write (fuzzy anchor keeps
    // matching), so all six apply.
    const succeeded = results.filter(result => result.success).length;
    expect(succeeded).toBe(6);
    const content = await fs.readFile(path.join(workspaceRoot, 'log.txt'), 'utf8');
    expect(content).toContain('line-5');
  });
});
