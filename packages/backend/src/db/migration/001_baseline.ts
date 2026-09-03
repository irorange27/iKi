import { getDb } from '../database';
import type { Migration } from './runner';

// Baseline schema generated on 2026-09-04 by replaying the full legacy
// migration chain (001_add_chat_tables .. 041_add_tool_allowlist_table) on a
// fresh database, then squashing the chain (ADR-style): pre-baseline
// databases are detected in initializeMigrations and marked as already
// baseline, so they open unchanged. Re-generate by replaying a chain when the
// schema changes materially; otherwise append forward migrations above 001.
const BASELINE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS affect_states (
        thread_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        reason TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      )`,
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
  `CREATE TABLE IF NOT EXISTS assistant_profiles (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role_summary TEXT NOT NULL DEFAULT '',
        owner_display_name TEXT NOT NULL DEFAULT '',
        tone_guidance TEXT NOT NULL DEFAULT '',
        hard_boundaries_json TEXT,
        collaboration_style_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS awaiter_wake_events (
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
  `CREATE TABLE IF NOT EXISTS chat_messages (
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
            )`,
  `CREATE TABLE IF NOT EXISTS chat_thread_context (
    thread_id TEXT PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    covered_message_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_thread_todos (
        thread_id TEXT PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
        items TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
  `CREATE TABLE IF NOT EXISTS chat_tool_approval_sessions (
        session_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        assistant_message_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        model TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        enabled_tools TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, available_skill_ids TEXT NOT NULL DEFAULT '[]', max_output_tokens INTEGER DEFAULT NULL, max_iterations INTEGER DEFAULT NULL, provider_id TEXT DEFAULT NULL, max_input_tokens INTEGER DEFAULT NULL, run_id TEXT DEFAULT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS chat_tool_approvals (
        approval_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        tool_args TEXT,
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'answered', 'consumed')),
        decision TEXT CHECK(decision IN ('approved', 'rejected')),
        decision_reason TEXT,
        responded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_tool_approval_sessions(session_id) ON DELETE CASCADE
      )`,
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
  `CREATE TABLE IF NOT EXISTS clipboard_snapshots (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        content_preview TEXT NOT NULL,
        content_length INTEGER NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'text/plain',
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS continuity_evidence (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        thread_id TEXT,
        message_id TEXT,
        excerpt TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES continuity_items(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL,
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
      )`,
  `CREATE TABLE IF NOT EXISTS continuity_items (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        confidence REAL NOT NULL DEFAULT 0,
        priority REAL NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT 'global',
        subject_key TEXT,
        source_kind TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        first_seen_at TEXT,
        last_confirmed_at TEXT,
        last_used_at TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS emotion_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        emotion TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS identity_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        self_description TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        owner_role_description TEXT NOT NULL DEFAULT '',
        core_values TEXT,
        boundaries TEXT,
        tone_guidance TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
  `CREATE TABLE IF NOT EXISTS memory_long (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding TEXT NOT NULL,
        source_message_ids TEXT,
        emotion TEXT,
        tags TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS memory_short (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT,
        importance REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      )`,
  `CREATE TABLE IF NOT EXISTS proactive_tasks (
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
        updated_at TEXT NOT NULL, cron_expression TEXT, schedule_timezone TEXT, tool_mode TEXT NOT NULL DEFAULT 'auto', provider_id TEXT,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL
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
  `CREATE TABLE IF NOT EXISTS "providers"(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT NOT NULL,
      models TEXT NOT NULL,
      model_options TEXT NOT NULL DEFAULT '{}',
      base_url TEXT,
      enabled BOOLEAN NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      available_models TEXT NOT NULL DEFAULT '[]',
      api_version TEXT,
      is_response_api INTEGER DEFAULT 0,
      acp_command TEXT,
      acp_args TEXT,
      acp_mcp_server_ids TEXT,
      acp_auth_method_id TEXT,
      acp_api_provider_id TEXT,
      acp_model_mapping TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS todo_items (
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
      )`,
  `CREATE TABLE IF NOT EXISTS todo_lists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_key TEXT NOT NULL UNIQUE,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS tool_allowlist (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        pattern TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS workflow_profiles (
        thread_id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
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
  `CREATE INDEX IF NOT EXISTS idx_affect_states_updated ON affect_states(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_run_created
        ON agent_run_checkpoints(run_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_run_step
        ON agent_run_checkpoints(run_id, step_index DESC)`,
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
  `CREATE INDEX IF NOT EXISTS idx_assistant_profiles_updated
        ON assistant_profiles(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiter_wake_events_awaiter_created
        ON awaiter_wake_events(awaiter_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiter_wake_events_run_id
        ON awaiter_wake_events(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiters_origin_run
        ON awaiters(origin_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiters_status_next_wake
        ON awaiters(status, next_wake_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_awaiters_thread_updated
        ON awaiters(thread_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_thread_context_updated
  ON chat_thread_context(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_thread_todos_updated
        ON chat_thread_todos(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_threads_client_id ON chat_threads(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_tool_approval_sessions_run_id
      ON chat_tool_approval_sessions(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_tool_approval_sessions_thread_id
      ON chat_tool_approval_sessions(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_tool_approvals_session_id
      ON chat_tool_approvals(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_tool_approvals_state
      ON chat_tool_approvals(state)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_usage_created_at
        ON chat_usage_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_usage_provider_model
        ON chat_usage_events(provider_type, model)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_usage_thread_created
        ON chat_usage_events(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_clipboard_snapshots_captured
        ON clipboard_snapshots(captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_clipboard_snapshots_hash
        ON clipboard_snapshots(content_hash, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_continuity_evidence_item
        ON continuity_evidence(item_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_continuity_items_kind
        ON continuity_items(profile_id, kind, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_continuity_items_profile_status
        ON continuity_items(profile_id, status, updated_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_continuity_items_source_ref
        ON continuity_items(profile_id, source_ref)
        WHERE source_ref IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_emotion_events_thread ON emotion_events(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_emotion_events_updated ON emotion_events(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_eval_labels_run
        ON agent_run_eval_labels(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_eval_labels_step
        ON agent_run_eval_labels(step_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_profiles_single_active
        ON identity_profiles(active)
        WHERE active = 1`,
  `CREATE INDEX IF NOT EXISTS idx_identity_profiles_updated_at
        ON identity_profiles(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_long_thread ON memory_long(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_long_updated ON memory_long(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_short_thread ON memory_short(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_short_updated ON memory_short(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_proactive_tasks_enabled_next_run
        ON proactive_tasks(enabled, next_run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_todo_items_list_sort
        ON todo_items(list_id, sort_order, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_todo_lists_updated_at
        ON todo_lists(updated_at DESC)`,
];

export const migration: Migration = {
  name: '001_baseline',
  up: () => {
    for (const statement of BASELINE_STATEMENTS) {
      getDb().exec(statement);
    }
  },
};
