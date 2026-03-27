import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getChatThreadMock,
  updateChatThreadMock,
  getWorkspaceMock,
  getWorkspaceByPathMock,
  addWorkspaceMock,
  updateWorkspaceMock,
} = vi.hoisted(() => ({
  getChatThreadMock: vi.fn(),
  updateChatThreadMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getWorkspaceByPathMock: vi.fn(),
  addWorkspaceMock: vi.fn(),
  updateWorkspaceMock: vi.fn(),
}));

vi.mock('../../../src/core/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
  updateChatThread: updateChatThreadMock,
}));

vi.mock('../../../src/core/db/workspaces', () => ({
  getWorkspace: getWorkspaceMock,
  getWorkspaceByPath: getWorkspaceByPathMock,
  addWorkspace: addWorkspaceMock,
  updateWorkspace: updateWorkspaceMock,
}));

const tempDirs: string[] = [];

const createTempUserDataPath = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-thread-workspace-'));
  tempDirs.push(directory);
  process.env.IKI_USER_DATA_PATH = directory;
  return directory;
};

describe('thread workspace helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.IKI_USER_DATA_PATH;
  });

  afterEach(() => {
    delete process.env.IKI_USER_DATA_PATH;
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (!directory) continue;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates a hidden temporary workspace for a thread that has no workspace yet', async () => {
    const userDataPath = createTempUserDataPath();
    const thread = {
      id: 'thread_1',
      title: 'Scratch Thread',
      workspace_id: null,
    };
    const expectedWorkspacePath = path.join(userDataPath, 'thread-workspaces', 'thread_1');
    const expectedWorkspaceId = 'workspace_thread_thread_1';

    getChatThreadMock.mockReturnValue(thread);
    getWorkspaceByPathMock.mockReturnValue(null);
    getWorkspaceMock.mockImplementation((id: string) =>
      id === expectedWorkspaceId
        ? {
            id,
            path: expectedWorkspacePath,
            name: 'Scratch Thread Scratch',
            is_temporary: 1,
            show_in_list: 0,
          }
        : null
    );

    const { ensureThreadWorkspaceSelection, buildThreadWorkspaceSystemMessage } = await import(
      '../../../src/core/workspaces/thread_workspace'
    );

    const selection = ensureThreadWorkspaceSelection('thread_1');

    expect(addWorkspaceMock).toHaveBeenCalledWith({
      id: expectedWorkspaceId,
      path: expectedWorkspacePath,
      name: 'Scratch Thread Scratch',
      is_temporary: 1,
      show_in_list: 0,
    });
    expect(updateChatThreadMock).toHaveBeenCalledWith('thread_1', {
      workspace_id: expectedWorkspaceId,
    });
    expect(selection).toEqual({
      threadId: 'thread_1',
      workspaceId: expectedWorkspaceId,
      workspace: expect.objectContaining({
        id: expectedWorkspaceId,
        path: expectedWorkspacePath,
      }),
    });
    expect(fs.existsSync(expectedWorkspacePath)).toBe(true);

    const message = buildThreadWorkspaceSystemMessage('thread_1');
    expect(message).toContain(expectedWorkspacePath);
    expect(message).toContain(path.join(userDataPath, 'brain'));
  });

  it('reuses an existing temporary workspace record for the thread path', async () => {
    createTempUserDataPath();
    const existingWorkspace = {
      id: 'workspace_existing',
      path: path.join(process.env.IKI_USER_DATA_PATH as string, 'thread-workspaces', 'thread_2'),
      name: 'Old temp',
      is_temporary: 0,
      show_in_list: 1,
    };
    getChatThreadMock.mockReturnValue({
      id: 'thread_2',
      title: 'Existing Thread',
      workspace_id: null,
    });
    getWorkspaceByPathMock.mockReturnValue(existingWorkspace);
    getWorkspaceMock.mockImplementation((id: string) =>
      id === existingWorkspace.id
        ? {
            ...existingWorkspace,
            name: 'Existing Thread Scratch',
            is_temporary: 1,
            show_in_list: 0,
          }
        : null
    );

    const { ensureThreadWorkspaceSelection } = await import(
      '../../../src/core/workspaces/thread_workspace'
    );

    const selection = ensureThreadWorkspaceSelection('thread_2');

    expect(addWorkspaceMock).not.toHaveBeenCalled();
    expect(updateWorkspaceMock).toHaveBeenCalledWith(existingWorkspace.id, {
      name: 'Existing Thread Scratch',
      is_temporary: 1,
      show_in_list: 0,
    });
    expect(updateChatThreadMock).toHaveBeenCalledWith('thread_2', {
      workspace_id: existingWorkspace.id,
    });
    expect(selection?.workspaceId).toBe(existingWorkspace.id);
  });
});
