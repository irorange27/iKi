import { ipcMain } from 'electron';

import type { DevToolsResolveRequest, DevToolsSourceResult } from '@iki/backend/types/devtools';

import {
  armElementRecorder,
  resolveElement,
  resolveElementExact,
} from '../services/devtools/element_source';

let devtoolsIpcRegistered = false;

/**
 * Three entry points, all for the same question ("where does this element come
 * from?") asked by different callers:
 * - `devtools:install-recorder` — arm click/hover capture before the user acts;
 * - `devtools:probe-element` — in-app probe (the `element_source` tool path);
 * - `devtools:resolve-element` — probe + sourcemap hop, for a caller that
 *   measured the bundled position over CDP itself.
 *
 * A probe without an explicit `webContentsId` runs against the window that
 * asked (the IPC sender), not "whatever is focused": the CLI drives one target
 * over CDP while the focused window can be another one (DevTools, companion).
 */
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

  // Arm on every window as it loads, so a click made before the first probe is
  // still the one `selected` answers with.
  armElementRecorder();

  ipcMain.handle(
    'devtools:install-recorder',
    async (event, payload?: DevToolsResolveRequest): Promise<DevToolsSourceResult> => {
      try {
        // Probing also arms the recorder; a miss just means nothing has been
        // clicked yet, and the next click is then captured.
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
