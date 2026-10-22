
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
