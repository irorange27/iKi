import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '039_add_agent_eval_labels_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS agent_run_eval_labels (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT,
        label TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (step_id) REFERENCES agent_run_steps(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_eval_labels_run
        ON agent_run_eval_labels(run_id);
      CREATE INDEX IF NOT EXISTS idx_eval_labels_step
        ON agent_run_eval_labels(step_id);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS agent_run_eval_labels;
    `);
  },
};
