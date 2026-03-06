import db from './database';
import { PromptApp } from '../../shared/types/chat';

type PromptAppRow = PromptApp & {
  enabled?: number;
  sort_order?: number;
  expects_image_result?: number;
  is_incognito?: number;
  placeholders?: string;
};

export const getPromptApps = (): PromptApp[] => {
  const rows = db
    .prepare('SELECT * FROM prompt_apps ORDER BY sort_order ASC, created_at DESC')
    .all() as PromptAppRow[];
  return rows.map(row => ({
    ...row,
    enabled: row.enabled !== undefined ? row.enabled : 1,
    sort_order: row.sort_order || 0,
    expects_image_result: row.expects_image_result || 0,
    is_incognito: row.is_incognito || 0,
    placeholders: row.placeholders || '[]',
  }));
};

export const getPromptApp = (id: string): PromptApp | null => {
  const row = db.prepare('SELECT * FROM prompt_apps WHERE id = ?').get(id) as
    | PromptAppRow
    | undefined;
  if (!row) return null;
  return {
    ...row,
    enabled: row.enabled !== undefined ? row.enabled : 1,
    sort_order: row.sort_order || 0,
    expects_image_result: row.expects_image_result || 0,
    is_incognito: row.is_incognito || 0,
    placeholders: row.placeholders || '[]',
  };
};

export const getEnabledPromptApps = (): PromptApp[] => {
  const rows = db
    .prepare('SELECT * FROM prompt_apps WHERE enabled = 1 ORDER BY sort_order ASC, created_at DESC')
    .all() as PromptAppRow[];
  return rows.map(row => ({
    ...row,
    enabled: 1,
    sort_order: row.sort_order || 0,
    expects_image_result: row.expects_image_result || 0,
    is_incognito: row.is_incognito || 0,
    placeholders: row.placeholders || '[]',
  }));
};

export const addPromptApp = (
  app: Partial<PromptApp> & { id: string; name: string; prompt_template: string }
) => {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
        INSERT INTO prompt_apps (
            id, name, description, icon, prompt_template, placeholders, model, enabled, sort_order,
            created_at, updated_at, tools, reasoning_effort, expects_image_result, is_incognito,
            shortcut, window_width, window_height, font_size
        ) VALUES (
            @id, @name, @description, @icon, @prompt_template, @placeholders, @model, @enabled, @sort_order,
            @created_at, @updated_at, @tools, @reasoning_effort, @expects_image_result, @is_incognito,
            @shortcut, @window_width, @window_height, @font_size
        )
    `);

  const data = {
    id: app.id,
    name: app.name,
    description: app.description || null,
    icon: app.icon || null,
    prompt_template: app.prompt_template,
    placeholders: app.placeholders || '[]',
    model: app.model || null,
    enabled: app.enabled !== undefined ? app.enabled : 1,
    sort_order: app.sort_order || 0,
    created_at: now,
    updated_at: now,
    tools: app.tools || null,
    reasoning_effort: app.reasoning_effort || null,
    expects_image_result: app.expects_image_result || 0,
    is_incognito: app.is_incognito || 0,
    shortcut: app.shortcut || null,
    window_width: app.window_width || null,
    window_height: app.window_height || null,
    font_size: app.font_size || null,
  };

  return stmt.run(data);
};

export const updatePromptApp = (id: string, app: Partial<PromptApp>) => {
  const now = new Date().toISOString();
  const fields = Object.keys(app)
    .filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at')
    .map(key => `${key} = @${key}`)
    .join(', ');

  if (!fields) return null;

  const stmt = db.prepare(`
        UPDATE prompt_apps 
        SET ${fields}, updated_at = @updated_at 
        WHERE id = @id
    `);

  const params: Partial<PromptApp> & { id: string; updated_at: string } = {
    ...app,
    id,
    updated_at: now,
  };
  if (params.enabled !== undefined) params.enabled = params.enabled ? 1 : 0;
  if (params.expects_image_result !== undefined)
    params.expects_image_result = params.expects_image_result ? 1 : 0;
  if (params.is_incognito !== undefined) params.is_incognito = params.is_incognito ? 1 : 0;

  return stmt.run(params);
};

export const deletePromptApp = (id: string) => {
  return db.prepare('DELETE FROM prompt_apps WHERE id = ?').run(id);
};

export const togglePromptAppEnabled = (id: string) => {
  const app = getPromptApp(id);
  if (!app) return null;
  return updatePromptApp(id, { enabled: app.enabled === 1 ? 0 : 1 });
};

export const updatePromptAppSortOrder = (id: string, sortOrder: number) => {
  return updatePromptApp(id, { sort_order: sortOrder });
};
