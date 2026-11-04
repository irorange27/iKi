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

vi.mock('@iki/backend/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

vi.mock('@iki/backend/db/providers', () => ({
  getProviders: vi.fn(),
  getProvider: vi.fn(),
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
}));

vi.mock('@iki/backend/db/workspaces', () => ({
  getWorkspaces: vi.fn(),
  getVisibleWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceByPath: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock('@iki/backend/db/prompt_apps', () => ({
  getEnabledPromptApps: vi.fn(),
}));

import { registerPromptAppsIpc } from '../../../packages/desktop/src/main/ipc/prompt_apps';
import { registerProvidersIpc } from '../../../packages/desktop/src/main/ipc/providers';
import { registerWorkspacesIpc } from '../../../packages/desktop/src/main/ipc/workspaces';
import * as promptAppDb from '@iki/backend/db/prompt_apps';
import * as providerDb from '@iki/backend/db/providers';
import * as workspaceDb from '@iki/backend/db/workspaces';

const getEnabledPromptAppsMock = vi.mocked(promptAppDb.getEnabledPromptApps);

const addProviderMock = vi.mocked(providerDb.addProvider);
const deleteProviderMock = vi.mocked(providerDb.deleteProvider);
const getProviderMock = vi.mocked(providerDb.getProvider);
const getProvidersMock = vi.mocked(providerDb.getProviders);
const updateProviderMock = vi.mocked(providerDb.updateProvider);

const getVisibleWorkspacesMock = vi.mocked(workspaceDb.getVisibleWorkspaces);
const getWorkspaceByPathMock = vi.mocked(workspaceDb.getWorkspaceByPath);
const getWorkspaceMock = vi.mocked(workspaceDb.getWorkspace);
const getWorkspacesMock = vi.mocked(workspaceDb.getWorkspaces);

beforeAll(() => {
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
  it('keeps repeated registration idempotent for providers/workspaces/prompt apps', () => {
    const initialCount = ipcHandleMock.mock.calls.length;

    registerProvidersIpc();
    registerWorkspacesIpc();
    registerPromptAppsIpc();

    expect(ipcHandleMock).toHaveBeenCalledTimes(initialCount);
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
    expect(
      await ipcHandlers.get('providers:update')?.(null, 'provider_1', { enabled: true })
    ).toEqual({
      success: true,
    });
    expect(await ipcHandlers.get('providers:delete')?.(null, 'provider_1')).toEqual({
      success: true,
    });
    const providerUpdateEvents = providerWindowSendMock.mock.calls.filter(
      (call): call is [string, { action: string; providerId: string }] =>
        call[0] === 'providers:updated'
    );
    expect(providerUpdateEvents).toEqual([
      [
        'providers:updated',
        {
          action: 'added',
          providerId: 'provider_new',
        },
      ],
      [
        'providers:updated',
        {
          action: 'updated',
          providerId: 'provider_1',
        },
      ],
      [
        'providers:updated',
        {
          action: 'deleted',
          providerId: 'provider_1',
        },
      ],
    ]);

    const addError = new Error('add failed');
    addProviderMock.mockImplementationOnce(() => {
      throw addError;
    });
    await expect(ipcHandlers.get('providers:add')?.(null, { id: 'provider_bad' })).rejects.toThrow(
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
    await expect(
      ipcHandlers.get('providers:update')?.(null, 'provider_1', { enabled: false })
    ).rejects.toThrow('update failed');
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.providers.update',
        outcome: 'failed',
        error: updateError,
      })
    );
  }, 15000);

  it('forwards the surviving workspace handlers with normalized defaults', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T09:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    getWorkspacesMock.mockReturnValue([{ id: 'workspace_1' } as never]);
    getWorkspaceMock.mockImplementation((id: string) => ({ id, name: 'Workspace' }) as never);
    getWorkspaceByPathMock.mockReturnValue({ id: 'workspace_path' } as never);
    getVisibleWorkspacesMock.mockReturnValue([{ id: 'workspace_visible' } as never]);
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/chosen'],
    });

    expect(await ipcHandlers.get('workspaces:list')?.(null)).toEqual([{ id: 'workspace_1' }]);
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
  });

  it('forwards prompt app getEnabled through the db layer', async () => {
    getEnabledPromptAppsMock.mockReturnValue([{ id: 'app_enabled' } as never]);

    expect(await ipcHandlers.get('promptApps:getEnabled')?.(null)).toEqual([{ id: 'app_enabled' }]);
  });
});
