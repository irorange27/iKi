import { ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';

import { createLogger } from '@iki/core/logger';
import {
  getSkillFolderPath,
  getSkillRootsForUi,
  listSkills,
  readSkillContent,
} from '@iki/harness/tools/skills';
import { getErrorMessage } from '@iki/core/utils/errors';
import { withIpcLogging } from '../utils/ipc_helpers';

let skillsIpcRegistered = false;
const skillsIpcLogger = createLogger({ module: 'skills_ipc' });

export const registerSkillsIpc = (): void => {
  if (skillsIpcRegistered) return;
  skillsIpcRegistered = true;

  ipcMain.handle('skills:list', () =>
    withIpcLogging<Awaited<ReturnType<typeof listSkills>>>(skillsIpcLogger, 'ipc.skills.list', () => listSkills({ forceRefresh: true }), {
      onError: () => [],
    })
  );

  ipcMain.handle('skills:roots', () =>
    withIpcLogging<ReturnType<typeof getSkillRootsForUi>>(skillsIpcLogger, 'ipc.skills.roots', () => getSkillRootsForUi(), {
      onError: () => [],
    })
  );

  ipcMain.handle('skills:open-root', async (_event, source?: string) => {
    try {
      const roots = getSkillRootsForUi();
      const normalizedSource = source === 'agent' ? 'agent' : 'user';
      const target = roots.find(r => r.source === normalizedSource) || roots[0];
      if (!target?.path) {
        return { success: false, error: 'No skills folder configured' };
      }

      await fs.mkdir(target.path, { recursive: true });
      const errorText = await shell.openPath(target.path);
      if (errorText) {
        return { success: false, error: errorText, path: target.path };
      }
      return { success: true, path: target.path };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('skills:open-skill', async (_event, id: string) => {
    try {
      const folderPath = await getSkillFolderPath(id);
      if (!folderPath) {
        return { success: false, error: 'Skill not found' };
      }
      const errorText = await shell.openPath(folderPath);
      if (errorText) {
        return { success: false, error: errorText, path: folderPath };
      }
      return { success: true, path: folderPath };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('skills:read', async (_event, id: string, options?: { maxChars?: number }) => {
    try {
      const content = await readSkillContent(id, { maxChars: options?.maxChars });
      if (!content) {
        return { success: false, error: 'Skill not found' };
      }
      return { success: true, ...content };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });
};
