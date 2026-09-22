import { randomUUID } from 'node:crypto';
import { getDb } from './database';

export type ToolAllowlistEntry = {
  id: string;
  toolName: string;
  pattern: string;
  createdAt: string;
};

/**
 * Learned "always allow" patterns (ADR 005 step 3). A row auto-approves
 * actions of `tool_name` whose complete input equals the JSON `pattern`
 * (empty pattern = blanket-allow the tool).
 */

// ponytail: per-process memo, cleared by the writers below. Ceiling: another
// process sharing this database (desktop + daemon) can insert a rule this one
// does not see until the next clear; drop the memo if that ever matters — the
// point query without it is ~0.005 ms.
const patternMemo = new Map<string, string[]>();

const mapRow = (row: Record<string, unknown>): ToolAllowlistEntry => ({
  id: row.id as string,
  toolName: row.tool_name as string,
  pattern: row.pattern as string,
  createdAt: row.created_at as string,
});

export const listToolAllowlist = (): ToolAllowlistEntry[] => {
  const rows = getDb()
    .prepare('SELECT id, tool_name, pattern, created_at FROM tool_allowlist ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(mapRow);
};

export const addToolAllowlistEntry = (input: {
  toolName: string;
  pattern: string;
}): ToolAllowlistEntry => {
  const entry: ToolAllowlistEntry = {
    id: randomUUID(),
    toolName: input.toolName,
    pattern: input.pattern,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      'INSERT INTO tool_allowlist (id, tool_name, pattern, created_at) VALUES (@id, @tool_name, @pattern, @created_at)'
    )
    .run({
      id: entry.id,
      tool_name: entry.toolName,
      pattern: entry.pattern,
      created_at: entry.createdAt,
    });
  patternMemo.clear();
  return entry;
};

export const removeToolAllowlistEntry = (id: string): { success: boolean } => {
  const result = getDb().prepare('DELETE FROM tool_allowlist WHERE id = @id').run({ id });
  patternMemo.clear();
  return { success: result.changes > 0 };
};

/** Allowlist patterns for one tool; empty pattern entries blanket-allow it. */
export const listToolAllowPatterns = (toolName: string): string[] => {
  const cached = patternMemo.get(toolName);
  if (cached) return cached;

  try {
    const rows = getDb()
      .prepare(
        'SELECT pattern FROM tool_allowlist WHERE tool_name = ? ORDER BY created_at DESC'
      )
      .all(toolName) as Record<string, unknown>[];
    const patterns = rows.map(row => String(row.pattern));
    patternMemo.set(toolName, patterns);
    return patterns;
  } catch {
    // No database in this context — no learned patterns.
    return [];
  }
};
