import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '035_add_agent_run_tables',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        thread_id TEXT,
        parent_run_id TEXT,
        root_run_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        provider_id TEXT,
        model TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        enabled_tools TEXT NOT NULL,
        available_skill_ids TEXT NOT NULL,
        input_json TEXT NOT NULL,
        working_json TEXT NOT NULL,
        output_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_id
        ON agent_runs(thread_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_root_run_id
        ON agent_runs(root_run_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run_id
        ON agent_runs(parent_run_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
        ON agent_runs(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_steps_run_step
        ON agent_run_steps(run_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id
        ON agent_run_steps(run_id, step_index);

      CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        reason TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_run_step
        ON agent_run_checkpoints(run_id, step_index DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_run_created
        ON agent_run_checkpoints(run_id, created_at DESC);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS agent_run_checkpoints;
      DROP TABLE IF EXISTS agent_run_steps;
      DROP TABLE IF EXISTS agent_runs;
    `);
  },
};
