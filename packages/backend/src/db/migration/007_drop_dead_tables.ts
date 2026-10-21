import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// Two tables lost their last owner and are now dropped here. Both are
// baseline-created (`001_baseline.ts`), so they cannot be removed from the
// squashed baseline itself — that file is the historical schema of record and
// a database that already ran it must still lose these tables.
//
// `agent_run_checkpoints` — zero INSERT in the whole repo. The baseline
// creates the table and two indexes, `db/agent_runs.ts` deletes rows during
// retention cleanup, and nothing ever wrote one: no `createAgentRunCheckpoint`
// / `getLatestAgentRunCheckpoint` implementation exists. The `AgentRunCheckpoint`
// type survives in `types/agent_run.ts` only as an unpopulated shape on
// `AgentRunTrace`; the table never backed it.
//
// `tool_allowlist` — the learned "always allow" pattern store (ADR 005 step 3).
// Its writers (`addToolAllowlistEntry` / `removeToolAllowlistEntry`) had no
// production caller, so the only live read (`listToolAllowPatterns` via
// `agent/harness/tool_resolver.ts`) always answered "no rules". A feature that
// can never hold a row still participated in the approval decision, which is
// worse than an absent one: it read as a configured allowlist. Table, reader
// module, resolver branch and the `allowPatterns` input are removed together.
// NOT the same thing as the MCP `tool_allowlist` COLUMN on `mcp_servers`,
// which is a live per-server tool filter and stays.
//
// Kept as its OWN migration rather than folded into 005/006: those are the
// memory/affect and thread-context removals, and a database that already ran
// them must still lose these two tables. Migration names are the replay unit,
// so mixing would strand every already-migrated database with orphan tables.
//
// Idempotent by construction: `DROP TABLE IF EXISTS` is a no-op on a database
// that already ran this, and the runner records the name so a second run never
// reaches it anyway. SQLite drops the tables' indexes with them.
const DEAD_TABLES = ['agent_run_checkpoints', 'tool_allowlist'];

const migration: Migration = {
  name: '007_drop_dead_tables',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
