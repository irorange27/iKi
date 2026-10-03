// Minimal structural type over node:sqlite shared by the database singleton
// and the migration chain. Kept dependency-free so migration modules can
// import the type without touching the database singleton module — the
// bootstrap handle flows DOWN (initializeDatabase → initializeMigrations(db)),
// never back up through a getDb import.

export type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };

export type SqliteStatement = {
  run: (...params: unknown[]) => SqliteRunResult;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};

export type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  transaction: <TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult
  ) => (...args: TArgs) => TResult;
  close: () => void;
};
