import { ipcMain } from 'electron';

import type { DevToolsResolveRequest, DevToolsSourceResult } from '@iki/backend/types/devtools';

import {
  armElementRecorder,
  resolveElement,
  resolveElementExact,
} from '../services/devtools/element_source';

let devtoolsIpcRegistered = false;

const senderScoped = (
  event: { sender: { id: number } },
  payload?: DevToolsResolveRequest
): DevToolsResolveRequest => ({
  ...payload,
  webContentsId: payload?.webContentsId ?? event.sender.id,
});

export const registerDevToolsIpc = (): void => {
  if (devtoolsIpcRegistered) return;
  devtoolsIpcRegistered = true;

  armElementRecorder();

  ipcMain.handle(
    'devtools:install-recorder',
    async (event, payload?: DevToolsResolveRequest): Promise<DevToolsSourceResult> => {
      try {
        await resolveElement({ ...senderScoped(event, payload), target: 'selected' });
        return { ok: true };
      } catch {
        return { ok: false, reason: 'recorder-failed' };
      }
    }
  );

  ipcMain.handle(
    'devtools:probe-element',
    async (event, payload?: DevToolsResolveRequest): Promise<DevToolsSourceResult> => {
      try {
        return await resolveElement(senderScoped(event, payload));
      } catch {
        return { ok: false, reason: 'probe-failed' };
      }
    }
  );

  ipcMain.handle(
    'devtools:resolve-element',
    async (event, payload?: DevToolsResolveRequest): Promise<DevToolsSourceResult> => {
      try {
        return await resolveElementExact(senderScoped(event, payload));
      } catch {
        return { ok: false, reason: 'resolve-failed' };
      }
    }
  );
};
