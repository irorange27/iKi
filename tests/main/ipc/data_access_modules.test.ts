import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { ipcHandlers, ipcHandleMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  ipcHandleMock: vi.fn((channel: string, handler: IpcHandler) => {
    ipcHandlers.set(channel, handler);
  }),
}));

const { showOpenDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
}));

const { browserWindowGetAllWindowsMock, providerWindowSendMock } = vi.hoisted(() => ({
  browserWindowGetAllWindowsMock: vi.fn(),
  providerWindowSendMock: vi.fn(),
}));

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
  BrowserWindow: {
    getAllWindows: (...args: unknown[]) => browserWindowGetAllWindowsMock(...args),
  },
}));

vi.mock('../../../src/core/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

vi.mock('../../../src/core/db/affect_state', () => ({
  getAffectState: vi.fn(),
}));

vi.mock('../../../src/core/db/memory', () => ({
  listShortMemory: vi.fn(),
  addShortMemory: vi.fn(),
  listShortMemoryAcrossThreads: vi.fn(),
  addLongMemory: vi.fn(),
  updateLongMemory: vi.fn(),
  deleteLongMemory: vi.fn(),
  listLongMemory: vi.fn(),
  listLongMemoryAcrossThreads: vi.fn(),
  searchLongMemory: vi.fn(),
  searchLongMemoryAcrossThreads: vi.fn(),
}));

vi.mock('../../../src/core/db/providers', () => ({
  getProviders: vi.fn(),
  getProvider: vi.fn(),
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
}));

vi.mock('../../../src/core/db/workspaces', () => ({
  getWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceByPath: vi.fn(),
  getVisibleWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  toggleWorkspaceVisibility: vi.fn(),
}));

vi.mock('../../../src/core/db/prompt_apps', () => ({
  getPromptApps: vi.fn(),
  getPromptApp: vi.fn(),
  getEnabledPromptApps: vi.fn(),
  addPromptApp: vi.fn(),
  updatePromptApp: vi.fn(),
  deletePromptApp: vi.fn(),
  togglePromptAppEnabled: vi.fn(),
  updatePromptAppSortOrder: vi.fn(),
}));

import { registerMemoryIpc } from '../../../src/main/ipc/memory';
import { registerPromptAppsIpc } from '../../../src/main/ipc/prompt_apps';
import { registerProvidersIpc } from '../../../src/main/ipc/providers';
import { registerWorkspacesIpc } from '../../../src/main/ipc/workspaces';
import * as affectDb from '../../../src/core/db/affect_state';
import * as memoryDb from '../../../src/core/db/memory';
import * as promptAppDb from '../../../src/core/db/prompt_apps';
import * as providerDb from '../../../src/core/db/providers';
import * as workspaceDb from '../../../src/core/db/workspaces';

const getAffectStateMock = vi.mocked(affectDb.getAffectState);
const addLongMemoryMock = vi.mocked(memoryDb.addLongMemory);
const addShortMemoryMock = vi.mocked(memoryDb.addShortMemory);
const deleteLongMemoryMock = vi.mocked(memoryDb.deleteLongMemory);
const listLongMemoryAcrossThreadsMock = vi.mocked(memoryDb.listLongMemoryAcrossThreads);
const listLongMemoryMock = vi.mocked(memoryDb.listLongMemory);
const listShortMemoryAcrossThreadsMock = vi.mocked(memoryDb.listShortMemoryAcrossThreads);
const listShortMemoryMock = vi.mocked(memoryDb.listShortMemory);
const searchLongMemoryAcrossThreadsMock = vi.mocked(memoryDb.searchLongMemoryAcrossThreads);
const searchLongMemoryMock = vi.mocked(memoryDb.searchLongMemory);
const updateLongMemoryMock = vi.mocked(memoryDb.updateLongMemory);

const addPromptAppMock = vi.mocked(promptAppDb.addPromptApp);
const deletePromptAppMock = vi.mocked(promptAppDb.deletePromptApp);
const getEnabledPromptAppsMock = vi.mocked(promptAppDb.getEnabledPromptApps);
const getPromptAppMock = vi.mocked(promptAppDb.getPromptApp);
const getPromptAppsMock = vi.mocked(promptAppDb.getPromptApps);
const togglePromptAppEnabledMock = vi.mocked(promptAppDb.togglePromptAppEnabled);
const updatePromptAppMock = vi.mocked(promptAppDb.updatePromptApp);
const updatePromptAppSortOrderMock = vi.mocked(promptAppDb.updatePromptAppSortOrder);

const addProviderMock = vi.mocked(providerDb.addProvider);
const deleteProviderMock = vi.mocked(providerDb.deleteProvider);
const getProviderMock = vi.mocked(providerDb.getProvider);
const getProvidersMock = vi.mocked(providerDb.getProviders);
const updateProviderMock = vi.mocked(providerDb.updateProvider);

const addWorkspaceMock = vi.mocked(workspaceDb.addWorkspace);
const deleteWorkspaceMock = vi.mocked(workspaceDb.deleteWorkspace);
const getVisibleWorkspacesMock = vi.mocked(workspaceDb.getVisibleWorkspaces);
const getWorkspaceByPathMock = vi.mocked(workspaceDb.getWorkspaceByPath);
const getWorkspaceMock = vi.mocked(workspaceDb.getWorkspace);
const getWorkspacesMock = vi.mocked(workspaceDb.getWorkspaces);
const toggleWorkspaceVisibilityMock = vi.mocked(workspaceDb.toggleWorkspaceVisibility);
const updateWorkspaceMock = vi.mocked(workspaceDb.updateWorkspace);

beforeAll(() => {
  registerMemoryIpc();
  registerProvidersIpc();
  registerWorkspacesIpc();
  registerPromptAppsIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
  browserWindowGetAllWindowsMock.mockReturnValue([
    {
      webContents: {
        send: providerWindowSendMock,
      },
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('data access IPC modules', () => {
  it('keeps repeated registration idempotent for memory/providers/workspaces/prompt apps', () => {
    const initialCount = ipcHandleMock.mock.calls.length;

    registerMemoryIpc();
    registerProvidersIpc();
    registerWorkspacesIpc();
    registerPromptAppsIpc();

    expect(ipcHandleMock).toHaveBeenCalledTimes(initialCount);
  });

  it('routes memory IPC handlers to the correct database helpers', async () => {
    listShortMemoryMock.mockReturnValue([{ id: 'short_1' } as never]);
    addShortMemoryMock.mockReturnValue({ success: true } as never);
    listShortMemoryAcrossThreadsMock.mockReturnValue([{ id: 'short_all' } as never]);
    addLongMemoryMock.mockReturnValue({ success: true } as never);
    updateLongMemoryMock.mockReturnValue({ success: true } as never);
    deleteLongMemoryMock.mockReturnValue({ success: true } as never);
    listLongMemoryMock.mockReturnValue([{ id: 'long_1' } as never]);
    listLongMemoryAcrossThreadsMock.mockReturnValue([{ id: 'long_all' } as never]);
    searchLongMemoryMock.mockReturnValue([{ id: 'search_1' } as never]);
    searchLongMemoryAcrossThreadsMock.mockReturnValue([{ id: 'search_all' } as never]);
    getAffectStateMock.mockReturnValue({ thread_id: 'thread_1' } as never);

    const shortEntry = { thread_id: 'thread_1', message_id: 'message_1', role: 'user', content: 'hi' };
    const longEntry = { thread_id: 'thread_1', summary: 'summary' };
    const longUpdates = { summary: 'updated' };
    const searchOptions = { limit: 3, threshold: 0.2 };

    expect(await ipcHandlers.get('memory:short:list')?.(null, 'thread_1', 5)).toEqual([{ id: 'short_1' }]);
    expect(await ipcHandlers.get('memory:short:add')?.(null, shortEntry)).toEqual({ success: true });
    expect(await ipcHandlers.get('memory:short:listAll')?.(null, 10)).toEqual([{ id: 'short_all' }]);
    expect(await ipcHandlers.get('memory:long:add')?.(null, longEntry)).toEqual({ success: true });
    expect(await ipcHandlers.get('memory:long:update')?.(null, 'long_1', longUpdates)).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('memory:long:delete')?.(null, 'long_1')).toEqual({ success: true });
    expect(await ipcHandlers.get('memory:long:list')?.(null, 'thread_1', 4)).toEqual([{ id: 'long_1' }]);
    expect(await ipcHandlers.get('memory:long:listAll')?.(null, 4)).toEqual([{ id: 'long_all' }]);
    expect(await ipcHandlers.get('memory:long:search')?.(null, 'thread_1', 'topic', searchOptions)).toEqual([
      { id: 'search_1' },
    ]);
    expect(await ipcHandlers.get('memory:long:searchAll')?.(null, 'topic', searchOptions)).toEqual([
      { id: 'search_all' },
    ]);
    expect(await ipcHandlers.get('memory:affect:get')?.(null, 'thread_1')).toEqual({
      thread_id: 'thread_1',
    });

    expect(listShortMemoryMock).toHaveBeenCalledWith('thread_1', 5);
    expect(addShortMemoryMock).toHaveBeenCalledWith(shortEntry);
    expect(listShortMemoryAcrossThreadsMock).toHaveBeenCalledWith(10);
    expect(addLongMemoryMock).toHaveBeenCalledWith(longEntry, { force: true });
    expect(updateLongMemoryMock).toHaveBeenCalledWith('long_1', longUpdates);
    expect(deleteLongMemoryMock).toHaveBeenCalledWith('long_1');
    expect(listLongMemoryMock).toHaveBeenCalledWith('thread_1', 4);
    expect(listLongMemoryAcrossThreadsMock).toHaveBeenCalledWith(4);
    expect(searchLongMemoryMock).toHaveBeenCalledWith('thread_1', 'topic', searchOptions);
    expect(searchLongMemoryAcrossThreadsMock).toHaveBeenCalledWith('topic', searchOptions);
    expect(getAffectStateMock).toHaveBeenCalledWith('thread_1');
  });

  it('forwards provider IPC handlers and rethrows write errors after logging', async () => {
    getProvidersMock.mockReturnValue([{ id: 'provider_1' } as never]);
    getProviderMock.mockReturnValue({ id: 'provider_1', name: 'OpenAI' } as never);
    addProviderMock.mockReturnValue({ id: 'provider_new' } as never);
    updateProviderMock.mockReturnValue({ success: true } as never);
    deleteProviderMock.mockReturnValue({ success: true } as never);

    expect(await ipcHandlers.get('providers:list')?.(null)).toEqual([{ id: 'provider_1' }]);
    expect(await ipcHandlers.get('providers:get')?.(null, 'provider_1')).toEqual({
      id: 'provider_1',
      name: 'OpenAI',
    });
    expect(await ipcHandlers.get('providers:add')?.(null, { id: 'provider_new' })).toEqual({
      id: 'provider_new',
    });
    expect(await ipcHandlers.get('providers:update')?.(null, 'provider_1', { enabled: true })).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('providers:delete')?.(null, 'provider_1')).toEqual({ success: true });
    expect(providerWindowSendMock).toHaveBeenNthCalledWith(1, 'providers:updated', {
      action: 'added',
      providerId: 'provider_new',
    });
    expect(providerWindowSendMock).toHaveBeenNthCalledWith(2, 'providers:updated', {
      action: 'updated',
      providerId: 'provider_1',
    });
    expect(providerWindowSendMock).toHaveBeenNthCalledWith(3, 'providers:updated', {
      action: 'deleted',
      providerId: 'provider_1',
    });

    const addError = new Error('add failed');
    addProviderMock.mockImplementationOnce(() => {
      throw addError;
    });
    expect(() => ipcHandlers.get('providers:add')?.(null, { id: 'provider_bad' })).toThrow(
      'add failed'
    );
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.providers.add',
        outcome: 'failed',
        error: addError,
      })
    );

    const updateError = new Error('update failed');
    updateProviderMock.mockImplementationOnce(() => {
      throw updateError;
    });
    expect(() =>
      ipcHandlers.get('providers:update')?.(null, 'provider_1', { enabled: false })
    ).toThrow('update failed');
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.providers.update',
        outcome: 'failed',
        error: updateError,
      })
    );
  });

  it('creates workspace records with normalized defaults and forwards remaining workspace handlers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T09:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    getWorkspacesMock.mockReturnValue([{ id: 'workspace_1' } as never]);
    getWorkspaceMock.mockImplementation((id: string) => ({ id, name: 'Workspace' } as never));
    getWorkspaceByPathMock.mockReturnValue({ id: 'workspace_path' } as never);
    getVisibleWorkspacesMock.mockReturnValue([{ id: 'workspace_visible' } as never]);
    updateWorkspaceMock.mockReturnValue({ success: true } as never);
    deleteWorkspaceMock.mockReturnValue({ success: true } as never);
    toggleWorkspaceVisibilityMock.mockReturnValue({ success: true } as never);
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/chosen'],
    });

    expect(await ipcHandlers.get('workspaces:list')?.(null)).toEqual([{ id: 'workspace_1' }]);
    expect(await ipcHandlers.get('workspaces:get')?.(null, 'workspace_1')).toEqual({
      id: 'workspace_1',
      name: 'Workspace',
    });
    expect(await ipcHandlers.get('workspaces:getByPath')?.(null, '/tmp')).toEqual({
      id: 'workspace_path',
    });
    expect(await ipcHandlers.get('workspaces:getVisible')?.(null)).toEqual([
      { id: 'workspace_visible' },
    ]);
    expect(await ipcHandlers.get('workspaces:pickDirectory')?.(null)).toEqual({
      id: 'workspace_path',
      name: 'Workspace',
    });
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose workspace folder',
      buttonLabel: 'Use as Workspace',
    });

    const created = await ipcHandlers.get('workspaces:create')?.(null, {
      path: '/tmp/demo',
      name: 'Demo',
    });
    const createdWorkspaceId = (created as { id: string }).id;
    expect(created).toEqual({
      id: expect.stringMatching(/^workspace_1774083600000_/),
      name: 'Workspace',
    });
    expect(addWorkspaceMock).toHaveBeenCalledWith({
      id: createdWorkspaceId,
      path: '/tmp/demo',
      name: 'Demo',
      is_temporary: 0,
      show_in_list: 1,
    });
    expect(getWorkspaceMock).toHaveBeenCalledWith(createdWorkspaceId);

    expect(await ipcHandlers.get('workspaces:update')?.(null, 'workspace_1', { name: 'Renamed' })).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('workspaces:delete')?.(null, 'workspace_1')).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('workspaces:toggleVisibility')?.(null, 'workspace_1')).toEqual({
      success: true,
    });
  });

  it('creates prompt apps with normalized defaults and forwards remaining prompt app handlers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T10:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.987654321);

    getPromptAppsMock.mockReturnValue([{ id: 'app_1' } as never]);
    getPromptAppMock.mockImplementation((id: string) => ({ id, name: 'Prompt App' } as never));
    getEnabledPromptAppsMock.mockReturnValue([{ id: 'app_enabled' } as never]);
    updatePromptAppMock.mockReturnValue({ success: true } as never);
    deletePromptAppMock.mockReturnValue({ success: true } as never);
    togglePromptAppEnabledMock.mockReturnValue({ success: true } as never);
    updatePromptAppSortOrderMock.mockReturnValue({ success: true } as never);

    expect(await ipcHandlers.get('promptApps:list')?.(null)).toEqual([{ id: 'app_1' }]);
    expect(await ipcHandlers.get('promptApps:get')?.(null, 'app_1')).toEqual({
      id: 'app_1',
      name: 'Prompt App',
    });
    expect(await ipcHandlers.get('promptApps:getEnabled')?.(null)).toEqual([{ id: 'app_enabled' }]);

    const created = await ipcHandlers.get('promptApps:create')?.(null, {
      name: 'Summarizer',
      prompt_template: 'Summarize {{input}}',
    });
    const createdPromptAppId = (created as { id: string }).id;
    expect(created).toEqual({
      id: expect.stringMatching(/^promptApp_1774087200000_/),
      name: 'Prompt App',
    });
    expect(addPromptAppMock).toHaveBeenCalledWith({
      id: createdPromptAppId,
      name: 'Summarizer',
      description: null,
      icon: null,
      prompt_template: 'Summarize {{input}}',
      placeholders: '[]',
      model: null,
      enabled: 1,
      sort_order: 0,
      tools: null,
      reasoning_effort: null,
      expects_image_result: 0,
      is_incognito: 0,
      shortcut: null,
      window_width: null,
      window_height: null,
      font_size: null,
    });

    expect(await ipcHandlers.get('promptApps:update')?.(null, 'app_1', { description: 'Updated' })).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('promptApps:delete')?.(null, 'app_1')).toEqual({ success: true });
    expect(await ipcHandlers.get('promptApps:toggleEnabled')?.(null, 'app_1')).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('promptApps:updateSortOrder')?.(null, 'app_1', 3)).toEqual({
      success: true,
    });
  });
});
