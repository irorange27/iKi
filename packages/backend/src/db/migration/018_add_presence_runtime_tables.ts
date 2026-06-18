import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '018_add_presence_runtime_tables',
  up: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS life_state;
      DROP TABLE IF EXISTS life_episodes;

      CREATE TABLE IF NOT EXISTS presence_episodes (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        presence TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        transition_reason TEXT NOT NULL,
        summary TEXT,
        trigger_type TEXT,
        trigger_ref TEXT,
        thread_id TEXT,
        client_id TEXT,
        task_id TEXT,
        snapshot_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_presence_episodes_profile_started
        ON presence_episodes(profile_id, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_presence_episodes_task
        ON presence_episodes(task_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS presence_state (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL UNIQUE,
        current_activity TEXT NOT NULL,
        presence TEXT NOT NULL,
        energy REAL NOT NULL,
        focus_budget REAL NOT NULL,
        social_availability REAL NOT NULL,
        current_episode_id TEXT,
        next_review_at TEXT,
        sleep_window_json TEXT,
        policy_version TEXT NOT NULL,
        state_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (current_episode_id) REFERENCES presence_episodes(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_presence_state_review
        ON presence_state(next_review_at);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS presence_state;
      DROP TABLE IF EXISTS presence_episodes;
    `);
  },
};
