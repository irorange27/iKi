import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '038_add_awaiters_tables',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS awaiters (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        origin_run_id TEXT,
        origin_checkpoint_id TEXT,
        trigger_kind TEXT NOT NULL,
        trigger_spec_json TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        notify INTEGER NOT NULL DEFAULT 1,
        provider_type TEXT NOT NULL,
        provider_id TEXT,
        model TEXT NOT NULL,
        resume_context_json TEXT,
        next_wake_at TEXT,
        last_wake_at TEXT,
        last_error TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_awaiters_status_next_wake
        ON awaiters(status, next_wake_at ASC);
      CREATE INDEX IF NOT EXISTS idx_awaiters_thread_updated
        ON awaiters(thread_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_awaiters_origin_run
        ON awaiters(origin_run_id);

      CREATE TABLE IF NOT EXISTS awaiter_wake_events (
        id TEXT PRIMARY KEY,
        awaiter_id TEXT NOT NULL,
        run_id TEXT,
        trigger_fired_at TEXT NOT NULL,
        trigger_snapshot_json TEXT,
        outcome TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (awaiter_id) REFERENCES awaiters(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_awaiter_wake_events_awaiter_created
        ON awaiter_wake_events(awaiter_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_awaiter_wake_events_run_id
        ON awaiter_wake_events(run_id);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS awaiter_wake_events;
      DROP TABLE IF EXISTS awaiters;
    `);
  },
};
