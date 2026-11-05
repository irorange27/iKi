import { readRows } from './collection';
import { PromptApp } from '@iki/core/types/chat';

export const getEnabledPromptApps = (): PromptApp[] => {
  return readRows<PromptApp>('prompt_apps')
    .filter(row => row.enabled === true)
    .sort((a, b) => {
      const byOrder = (a.sort_order || 0) - (b.sort_order || 0);
      if (byOrder !== 0) return byOrder;
      return String(b.created_at).localeCompare(String(a.created_at));
    })
    .map(row => ({
      ...row,
      enabled: true,
      sort_order: row.sort_order || 0,
      expects_image_result: row.expects_image_result === true,
      is_incognito: row.is_incognito === true,
    }));
};
