import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => Promise<unknown>;

const { ipcHandlers, resolveElementMock, resolveElementExactMock, armRecorderMock } = vi.hoisted(
  () => ({
    ipcHandlers: new Map<string, IpcHandler>(),
    resolveElementMock: vi.fn(),
    resolveElementExactMock: vi.fn(),
    armRecorderMock: vi.fn(),
  })
);

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../packages/desktop/src/main/services/devtools/element_source', () => ({
  resolveElement: resolveElementMock,
  resolveElementExact: resolveElementExactMock,
  armElementRecorder: armRecorderMock,
}));

import { registerDevToolsIpc } from '../../../packages/desktop/src/main/ipc/devtools';

beforeAll(() => {
  registerDevToolsIpc();
});

beforeEach(() => {
  resolveElementMock.mockReset();
  resolveElementExactMock.mockReset();
});

const call = (channel: string, payload?: unknown, senderId = 7) => {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`${channel} was not registered`);
  return handler({ sender: { id: senderId } }, payload);
};

describe('devtools ipc', () => {
  it('registers the three element→source channels', () => {
    expect([...ipcHandlers.keys()].sort()).toEqual([
      'devtools:install-recorder',
      'devtools:probe-element',
      'devtools:resolve-element',
    ]);
  });

  it('arms the page recorder for every window at registration', async () => {
    // Without this the recorder is only installed on the first probe, so the
    // click that prompted the question is the one that gets lost. Re-imported
    // because `clearMocks` wipes the history of the `beforeAll` registration.
    vi.resetModules();
    armRecorderMock.mockClear();
    const { registerDevToolsIpc: registerAgain } = await import(
      '../../../packages/desktop/src/main/ipc/devtools'
    );
    registerAgain();

    expect(armRecorderMock).toHaveBeenCalledTimes(1);
  });

  it('arms the recorder through the selected-element probe', async () => {
    resolveElementMock.mockResolvedValue({ ok: false, reason: 'no-selected-element' });

    await expect(call('devtools:install-recorder')).resolves.toEqual({ ok: true });
    expect(resolveElementMock).toHaveBeenCalledWith({ target: 'selected', webContentsId: 7 });
  });

  it('reports recorder failures instead of rejecting the IPC call', async () => {
    resolveElementMock.mockRejectedValue(new Error('window gone'));

    await expect(call('devtools:install-recorder')).resolves.toEqual({
      ok: false,
      reason: 'recorder-failed',
    });
  });

  it('probes the window that asked, not whatever happens to be focused', async () => {
    resolveElementMock.mockResolvedValue({ ok: true });

    await call('devtools:probe-element', { target: 'selector', selector: '.x' });
    expect(resolveElementMock).toHaveBeenCalledWith({
      target: 'selector',
      selector: '.x',
      webContentsId: 7,
    });

    // An explicit id still wins: a CDP caller may address another window.
    await call('devtools:probe-element', { target: 'hovered', webContentsId: 99 });
    expect(resolveElementMock).toHaveBeenLastCalledWith({ target: 'hovered', webContentsId: 99 });
  });

  it('turns a throwing exact resolution into a readable answer', async () => {
    resolveElementExactMock.mockRejectedValue(new Error('map unreadable'));

    await expect(call('devtools:resolve-element', { line: 9 })).resolves.toEqual({
      ok: false,
      reason: 'resolve-failed',
    });
  });
});
