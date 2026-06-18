import { sanitizeUiMessageJsonForStorage } from '../../chat/ui_message_codec';
import { getDb } from '../database';
import { Migration } from './runner';

type ChatMessageRow = {
  id: string;
  message: string;
};

type CanonicalizedChatMessageRow = {
  id: string;
  message: string;
};

const selectChatMessages = (): ChatMessageRow[] =>
  getDb()
    .prepare('SELECT id, message FROM chat_messages ORDER BY created_at ASC, id ASC')
    .all() as ChatMessageRow[];

const collectCanonicalizedRows = (
  rows: ChatMessageRow[]
): CanonicalizedChatMessageRow[] =>
  rows.flatMap(row => {
    const canonicalMessage = sanitizeUiMessageJsonForStorage(row.message);
    return canonicalMessage !== row.message ? [{ id: row.id, message: canonicalMessage }] : [];
  });

const updateCanonicalizedRows = (rows: CanonicalizedChatMessageRow[]) => {
  if (rows.length === 0) return;

  const database = getDb();
  const run = database.transaction((nextRows: CanonicalizedChatMessageRow[]) => {
    const statement = database.prepare('UPDATE chat_messages SET message = ? WHERE id = ?');
    for (const row of nextRows) {
      statement.run(row.message, row.id);
    }
  });

  run(rows);
};

export const migration: Migration = {
  name: '023_canonicalize_chat_ui_messages',
  up: () => {
    const rows = selectChatMessages();
    const canonicalizedRows = collectCanonicalizedRows(rows);
    updateCanonicalizedRows(canonicalizedRows);
  },
  down: () => {
    // Data canonicalization is lossy — original message JSON cannot be reconstructed.
  },
};
