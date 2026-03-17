import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '003_add_prompt_apps_table',
  up: () => {
    // Create prompt_apps table
    getDb().exec(`
            CREATE TABLE IF NOT EXISTS prompt_apps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT,
                prompt_template TEXT NOT NULL,
                placeholders TEXT NOT NULL DEFAULT '[]',
                model TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                tools TEXT,
                reasoning_effort TEXT,
                expects_image_result INTEGER NOT NULL DEFAULT 0,
                is_incognito INTEGER NOT NULL DEFAULT 0,
                shortcut TEXT,
                window_width INTEGER,
                window_height INTEGER,
                font_size INTEGER
            );
        `);
  },
  down: () => {
    // Drop prompt_apps table
    getDb().exec('DROP TABLE IF EXISTS prompt_apps;');
  },
};
