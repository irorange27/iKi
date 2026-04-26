/**
 * Build a safe SET clause for UPDATE statements.
 * Only keys in the allowedColumns set are interpolated as column names;
 * unknown keys are silently dropped to prevent SQL injection via dynamic
 * column name interpolation.
 */
export const buildSetClause = (
  record: Record<string, unknown>,
  allowedColumns: ReadonlySet<string>
): string => {
  const fields: string[] = [];

  for (const key of Object.keys(record)) {
    if (allowedColumns.has(key)) {
      fields.push(`${key} = @${key}`);
    }
  }

  return fields.join(', ');
};
