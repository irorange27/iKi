import { readRows } from './collection';
import { PromptApp } from '@iki/core/types/chat';

type PromptAppRow = PromptApp & {
  enabled?: number;
  sort_order?: number;
  expects_image_result?: number;
  is_incognito?: number;
  placeholders?: string;
};

export const getEnabledPromptApps = (): PromptApp[] => {
  return readRows<PromptAppRow>('prompt_apps')
    .filter(row => Number(row.enabled) === 1)
    .sort((a, b) => {
      const byOrder = (a.sort_order || 0) - (b.sort_order || 0);
      if (byOrder !== 0) return byOrder;
      return String(b.created_at).localeCompare(String(a.created_at));
    })
    .map(row => ({
      ...row,
      enabled: 1,
      sort_order: row.sort_order || 0,
      expects_image_result: row.expects_image_result || 0,
      is_incognito: row.is_incognito || 0,
      placeholders: row.placeholders || '[]',
    }));
};
