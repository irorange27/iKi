import { ipcMain } from 'electron';

import { toIpcSerializable } from '../../shared/utils/ipc_serialization';
import type { PresenceOwnerMode } from '../../shared/types/presence';
import {
  clearPresenceOwnerMode,
  getPresenceOverview,
  refreshPresenceRuntime,
  setPresenceOwnerMode,
} from '../services/presence/presence_runtime';

let presenceIpcRegistered = false;

export const registerPresenceIpc = (): void => {
  if (presenceIpcRegistered) return;
  presenceIpcRegistered = true;

  ipcMain.handle('presence:get-overview', (_event, limit?: number) =>
    toIpcSerializable(getPresenceOverview(limit))
  );
  ipcMain.handle('presence:refresh', async () =>
    toIpcSerializable(await refreshPresenceRuntime())
  );
  ipcMain.handle(
    'presence:set-owner-mode',
    (_event, mode: PresenceOwnerMode, note?: string | null) =>
      toIpcSerializable(setPresenceOwnerMode(mode, note))
  );
  ipcMain.handle('presence:clear-owner-mode', () => toIpcSerializable(clearPresenceOwnerMode()));
};
