import { getDb } from './database';
import { PromptApp } from '@iki/backend/types/chat';

type PromptAppRow = PromptApp & {
  enabled?: number;
  sort_order?: number;
  expects_image_result?: number;
  is_incognito?: number;
  placeholders?: string;
};

export const getEnabledPromptApps = (): PromptApp[] => {
  const rows = getDb()
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
