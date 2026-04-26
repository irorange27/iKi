import { getDb } from '../database';
import { Migration } from './runner';

type AppClientRow = {
  id: string;
  created_at: string;
};

const NAPCAT_CLIENT_ID = 'client_napcat';

const selectFirstUserClient = (): AppClientRow | null =>
  (getDb()
    .prepare(
      'SELECT id, created_at FROM app_clients WHERE id <> ? ORDER BY created_at ASC, id ASC LIMIT 1'
    )
    .get(NAPCAT_CLIENT_ID) as AppClientRow | undefined) ?? null;

const restoreLegacyDesktopThreadOwnership = (clientId: string, clientCreatedAt: string) => {
  if (!clientId || !clientCreatedAt) return;
  getDb()
    .prepare('UPDATE chat_threads SET client_id = NULL WHERE client_id = ? AND created_at < ?')
    .run(clientId, clientCreatedAt);
};

export const migration: Migration = {
  name: '027_restore_legacy_desktop_thread_ownership',
  up: () => {
    const firstUserClient = selectFirstUserClient();
    if (!firstUserClient) return;
    restoreLegacyDesktopThreadOwnership(firstUserClient.id, firstUserClient.created_at);
  },
  down: () => {
    // Ownership reassignment is lossy — the original client_id values cannot be reconstructed.
  },
};
