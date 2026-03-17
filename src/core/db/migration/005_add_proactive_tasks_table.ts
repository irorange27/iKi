import db from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '005_add_proactive_tasks_table',
  up: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS proactive_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL DEFAULT 'interval',
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1,
        provider_type TEXT NOT NULL,
        model TEXT NOT NULL,
        tools TEXT,
        thread_id TEXT,
        notify INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_run_at TEXT,
        last_status TEXT,
        last_output TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_proactive_tasks_enabled_next_run
        ON proactive_tasks(enabled, next_run_at);
    `);
  },
  down: () => {
    db.exec('DROP TABLE IF EXISTS proactive_tasks;');
  },
};

