import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '001_add_chat_tables',
  up: () => {
    // Create chat_threads table
    getDb().exec(`
            CREATE TABLE IF NOT EXISTS chat_threads (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model TEXT,
                is_generating BOOLEAN DEFAULT FALSE,
                reasoning_effort TEXT DEFAULT 'medium',
                metadata TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                prompt_app_id TEXT REFERENCES prompt_apps(id) ON DELETE SET NULL,
                tools TEXT,
                is_favorited INTEGER DEFAULT 0,
                is_incognito INTEGER DEFAULT 0,
                workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
                enable_artifacts INTEGER DEFAULT 0,
                artifact_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
                skill_ids TEXT
            );
        `);

    // Create chat_messages table
    getDb().exec(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                parent_id TEXT,
                slot_id TEXT,
                depth INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                metadata TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
            );
        `);
  },
  down: () => {
    // Drop tables in reverse order (messages first due to foreign key)
    getDb().exec('DROP TABLE IF EXISTS chat_messages;');
    getDb().exec('DROP TABLE IF EXISTS chat_threads;');
  },
};
