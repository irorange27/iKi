import { getDb } from '../database';
import { Migration } from './runner';

const hasProviderModelOptionsColumn = (): boolean => {
  const columns = getDb().prepare("PRAGMA table_info('providers')").all() as Array<{ name: string }>;
  return columns.some(column => column.name === 'model_options');
};

export const migration: Migration = {
  name: '024_add_provider_model_options',
  up: () => {
    if (hasProviderModelOptionsColumn()) return;

    getDb().exec(`
      ALTER TABLE providers
      ADD COLUMN model_options TEXT NOT NULL DEFAULT '{}'
    `);
  },
};
