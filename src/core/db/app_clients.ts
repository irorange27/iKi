import { randomBytes, createHash } from 'node:crypto';
import { getDb } from './database';

type AppClientRow = {
  id: string;
  name: string;
  token_hash: string;
  scopes: string;
  allowed_tools: string;
  created_at: string;
  updated_at: string;
  last_seen?: string | null;
};

export type AppClient = {
  id: string;
  name: string;
  tokenHash: string;
  scopes: string[];
  allowedTools: string[];
  created_at: string;
  updated_at: string;
  last_seen?: string | null;
};

export type CreateAppClientInput = {
  name: string;
  scopes?: string[];
  allowedTools?: string[];
  id?: string;
};

const nowIso = () => new Date().toISOString();

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
};

const parseStringArray = (raw: string | null | undefined): string[] => {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return toStringArray(parsed);
  } catch {
    return toStringArray(raw);
  }
};

const normalizeClient = (row: AppClientRow): AppClient => ({
  id: row.id,
  name: row.name,
  tokenHash: row.token_hash,
  scopes: parseStringArray(row.scopes),
  allowedTools: parseStringArray(row.allowed_tools),
  created_at: row.created_at,
  updated_at: row.updated_at,
  last_seen: row.last_seen ?? null,
});

const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const generateToken = (): string => `iki_${randomBytes(24).toString('hex')}`;

export const createAppClient = (input: CreateAppClientInput) => {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = nowIso();
  const id =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const scopes = toStringArray(input.scopes);
  const allowedTools = toStringArray(input.allowedTools);

  const stmt = getDb().prepare(`
    INSERT INTO app_clients (
      id, name, token_hash, scopes, allowed_tools, created_at, updated_at, last_seen
    ) VALUES (
      @id, @name, @token_hash, @scopes, @allowed_tools, @created_at, @updated_at, @last_seen
    )
  `);

  stmt.run({
    id,
    name: input.name,
    token_hash: tokenHash,
    scopes: JSON.stringify(scopes),
    allowed_tools: JSON.stringify(allowedTools),
    created_at: now,
    updated_at: now,
    last_seen: now,
  });

  const row = getDb().prepare('SELECT * FROM app_clients WHERE id = ?').get(id) as
    | AppClientRow
    | undefined;
  if (!row) {
    throw new Error('Failed to create app client');
  }

  return { client: normalizeClient(row), token };
};

export const getAppClientById = (id: string): AppClient | null => {
  const row = getDb().prepare('SELECT * FROM app_clients WHERE id = ?').get(id) as
    | AppClientRow
    | undefined;
  return row ? normalizeClient(row) : null;
};

export const getAppClientByToken = (token: string): AppClient | null => {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token.trim());
  const row = getDb().prepare('SELECT * FROM app_clients WHERE token_hash = ?').get(tokenHash) as
    | AppClientRow
    | undefined;
  return row ? normalizeClient(row) : null;
};

export const touchAppClient = (id: string) => {
  const now = nowIso();
  return getDb()
    .prepare('UPDATE app_clients SET last_seen = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
};

export const listAppClients = (): AppClient[] => {
  const rows = getDb()
    .prepare('SELECT * FROM app_clients ORDER BY updated_at DESC')
    .all() as AppClientRow[];
  return rows.map(normalizeClient);
};
