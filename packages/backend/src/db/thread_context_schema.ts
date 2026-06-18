export const CHAT_THREAD_CONTEXT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS chat_thread_context (
    thread_id TEXT PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    covered_message_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chat_thread_context_updated
  ON chat_thread_context(updated_at);
`;

export const DROP_CHAT_THREAD_CONTEXT_SCHEMA_SQL = 'DROP TABLE IF EXISTS chat_thread_context;';
