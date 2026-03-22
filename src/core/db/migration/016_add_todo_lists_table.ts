import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '016_add_todo_lists_table',
  aliases: ['015_add_todo_lists_table'],
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS todo_lists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_key TEXT NOT NULL UNIQUE,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS todo_items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL,
        content TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        sort_order INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_todo_lists_updated_at
        ON todo_lists(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_todo_items_list_sort
        ON todo_items(list_id, sort_order, created_at);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS todo_items;
      DROP TABLE IF EXISTS todo_lists;
    `);
  },
};
