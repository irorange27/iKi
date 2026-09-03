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
 * actions of `tool_name` whose stringified input contains `pattern`
 * (empty pattern = blanket-allow the tool).
 */

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
  return entry;
};

export const removeToolAllowlistEntry = (id: string): { success: boolean } => {
  const result = getDb().prepare('DELETE FROM tool_allowlist WHERE id = @id').run({ id });
  return { success: result.changes > 0 };
};

/** Allowlist patterns for one tool; empty pattern entries blanket-allow it. */
export const listToolAllowPatterns = (toolName: string): string[] => {
  try {
    return listToolAllowlist()
      .filter(entry => entry.toolName === toolName)
      .map(entry => entry.pattern);
  } catch {
    // No database in this context — no learned patterns.
    return [];
  }
};
