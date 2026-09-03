// ONE-OFF generator: runs the full legacy migration chain (001-041) on a
// fresh temp database and emits packages/backend/src/db/migration/001_baseline.ts.
// Delete this file after the squash lands.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

process.env.IKI_USER_DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-baseline-gen-'));

import { getDb } from '@iki/backend/db/database';
import { initializeMigrations } from '@iki/backend/db/migration';

describe('baseline generator (one-off)', () => {
  it('dumps the post-migration schema into 001_baseline.ts', () => {
    initializeMigrations();

    const rows = getDb()
      .prepare(
        `SELECT name, sql, type FROM sqlite_master
         WHERE sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE 'sqlite_autoindex_%'
           AND name != 'migrations'
         ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`
      )
      .all() as Array<{ name: string; sql: string; type: string }>;

    expect(rows.length).toBeGreaterThan(0);
    const tableNames = rows.filter(row => row.type === 'table').map(row => row.name);
    expect(tableNames).toEqual(expect.arrayContaining(['chat_threads', 'agent_runs', 'chat_tool_approvals', 'awaiters', 'identity_profiles']));

    const statements = rows.map(row => {
      let sql = row.sql.trim();
      sql = sql.replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ');
      sql = sql.replace(/^CREATE UNIQUE INDEX /i, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
      sql = sql.replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
      return sql;
    });

    const fileBody = `import { getDb } from '../database';
import type { Migration } from './runner';

// Baseline schema generated on 2026-09-04 by replaying the full legacy
// migration chain (001_add_chat_tables .. 041_add_tool_allowlist_table) on a
// fresh database. The legacy chain was then removed (ADR-style squash):
// pre-baseline databases are detected in initializeMigrations and marked as
// already baseline. Re-generate by replaying the chain when the schema
// changes materially; otherwise append forward migrations above 001.
const BASELINE_STATEMENTS: readonly string[] = [
${statements.map(sql => `  \`${sql.replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\$\{/g, '\\${')}\`,`).join('\n')}
];

export const migration: Migration = {
  name: '001_baseline',
  up: () => {
    for (const statement of BASELINE_STATEMENTS) {
      getDb().exec(statement);
    }
  },
};
`;

    const target = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../packages/backend/src/db/migration/001_baseline.ts'
    );
    fs.writeFileSync(target, fileBody);
    console.log(`[baseline-generator] wrote ${target} with ${statements.length} statements`);
    expect(fs.existsSync(target)).toBe(true);
  });
});
