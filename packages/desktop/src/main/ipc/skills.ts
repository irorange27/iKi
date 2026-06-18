import { ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';

import { createLogger } from '@iki/core/logger';
import {
  getSkillFolderPath,
  getSkillRootsForUi,
  listSkills,
  readSkillContent,
} from '@iki/core/tools/skills';
import { getErrorMessage } from '../utils/errors';

let skillsIpcRegistered = false;
const skillsIpcLogger = createLogger({ module: 'skills_ipc' });

export const registerSkillsIpc = (): void => {
  if (skillsIpcRegistered) return;
  skillsIpcRegistered = true;

  ipcMain.handle('skills:list', async () => {
    try {
      return await listSkills({ forceRefresh: true });
    } catch (error: unknown) {
      skillsIpcLogger.event({
        level: 'error',
        event: 'ipc.skills.list',
        outcome: 'failed',
        error,
      });
      return [];
    }
  });

  ipcMain.handle('skills:roots', () => {
    try {
      return getSkillRootsForUi();
    } catch (error: unknown) {
      skillsIpcLogger.event({
        level: 'error',
        event: 'ipc.skills.roots',
        outcome: 'failed',
        error,
      });
      return [];
    }
  });

  ipcMain.handle('skills:open-root', async (_event, source?: string) => {
    try {
      const roots = getSkillRootsForUi();
      const normalizedSource = source === 'codex' ? 'codex' : 'user';
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
