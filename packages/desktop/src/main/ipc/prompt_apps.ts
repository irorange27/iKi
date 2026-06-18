import { ipcMain } from 'electron';

import * as promptAppDb from '@iki/backend/db/prompt_apps';
import { createPrefixedId } from '@iki/core/utils/id';

let promptAppsIpcRegistered = false;

export const registerPromptAppsIpc = (): void => {
  if (promptAppsIpcRegistered) return;
  promptAppsIpcRegistered = true;

  ipcMain.handle('promptApps:list', () => promptAppDb.getPromptApps());
  ipcMain.handle('promptApps:get', (_event, id) => promptAppDb.getPromptApp(id));
  ipcMain.handle('promptApps:getEnabled', () => promptAppDb.getEnabledPromptApps());
  ipcMain.handle('promptApps:create', (_event, app) => {
    const appId = app.id || createPrefixedId('promptApp');
    promptAppDb.addPromptApp({
      id: appId,
      name: app.name,
      description: app.description || null,
      icon: app.icon || null,
      prompt_template: app.prompt_template,
      placeholders: app.placeholders || '[]',
      model: app.model || null,
      enabled: app.enabled !== undefined ? app.enabled : 1,
      sort_order: app.sort_order || 0,
      tools: app.tools || null,
      reasoning_effort: app.reasoning_effort || null,
      expects_image_result: app.expects_image_result || 0,
      is_incognito: app.is_incognito || 0,
      shortcut: app.shortcut || null,
      window_width: app.window_width || null,
      window_height: app.window_height || null,
      font_size: app.font_size || null,
    });
    return promptAppDb.getPromptApp(appId);
  });
  ipcMain.handle('promptApps:update', (_event, id, app) => promptAppDb.updatePromptApp(id, app));
  ipcMain.handle('promptApps:delete', (_event, id) => promptAppDb.deletePromptApp(id));
  ipcMain.handle('promptApps:toggleEnabled', (_event, id) => promptAppDb.togglePromptAppEnabled(id));
  ipcMain.handle('promptApps:updateSortOrder', (_event, id, sortOrder) =>
    promptAppDb.updatePromptAppSortOrder(id, sortOrder)
  );
};
