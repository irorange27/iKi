import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const BASELINE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_run_eval_labels (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT,
        label TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (step_id) REFERENCES agent_run_steps(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS agent_run_steps (
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
      )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
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
      )`,
  `CREATE TABLE IF NOT EXISTS app_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL DEFAULT '[]',
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen TEXT
      )`,
  `CREATE TABLE IF NOT EXISTS awaiters (
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
      )`,
  `CREATE TABLE IF NOT EXISTS chat_threads (
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
            , client_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS chat_usage_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        message_id TEXT,
        provider_type TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'chat',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT,
        cwd TEXT,
        env TEXT,
        base_url TEXT,
        headers TEXT,
        auth_ref TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        tool_allowlist TEXT,
        approval_mode TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_connected_at TEXT,
        last_error TEXT
      )`,
  `CREATE TABLE IF NOT EXISTS prompt_apps (
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
            )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                is_temporary INTEGER NOT NULL DEFAULT 0,
                show_in_list INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id
        ON agent_run_steps(run_id, step_index)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_steps_run_step
        ON agent_run_steps(run_id, step_index)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run_id
        ON agent_runs(parent_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_root_run_id
        ON agent_runs(root_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
        ON agent_runs(status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_id
        ON agent_runs(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_app_clients_token_hash ON app_clients(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiters_origin_run
        ON awaiters(origin_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiters_status_next_wake
        ON awaiters(status, next_wake_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiters_thread_updated
        ON awaiters(thread_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_threads_client_id ON chat_threads(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_usage_created_at
        ON chat_usage_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_usage_provider_model
        ON chat_usage_events(provider_type, model)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_usage_thread_created
        ON chat_usage_events(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_eval_labels_run
        ON agent_run_eval_labels(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_eval_labels_step
        ON agent_run_eval_labels(step_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_threads_updated_at
        ON chat_threads(updated_at DESC)`,
];

export const migration: Migration = {
  name: '001_baseline',
  up: (db: SqliteDatabase) => {
    for (const statement of BASELINE_STATEMENTS) {
      db.exec(statement);
    }
  },
};
