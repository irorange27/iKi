import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registeredMigrations } from '@iki/backend/db/migration';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../../packages/backend/src/db/migration');

describe('migration registration', () => {
  it('keeps migration files uniquely and sequentially numbered', () => {
    const migrationFiles = readdirSync(migrationDir)
      .filter(fileName => /^\d{3}_.+\.ts$/.test(fileName))
      .sort();
    const fileNumbers = migrationFiles.map(fileName => Number.parseInt(fileName.slice(0, 3), 10));

    expect(new Set(fileNumbers).size).toBe(fileNumbers.length);
    expect(fileNumbers).toEqual(
      Array.from({ length: migrationFiles.length }, (_value, index) => index + 1)
    );
  });

  it('keeps the registered migration names aligned with the canonical file sequence', () => {
    const migrationFiles = readdirSync(migrationDir)
      .filter(fileName => /^\d{3}_.+\.ts$/.test(fileName))
      .sort()
      .map(fileName => fileName.replace(/\.ts$/, ''));

    expect(registeredMigrations.map(migration => migration.name)).toEqual(migrationFiles);
  });
});
