import { getDb } from '../database';
import { Migration } from './runner';
import {
  CHAT_THREAD_CONTEXT_SCHEMA_SQL,
  DROP_CHAT_THREAD_CONTEXT_SCHEMA_SQL,
} from '../thread_context_schema';

export const migration: Migration = {
  name: '013_add_chat_thread_context_table',
  up: () => {
    getDb().exec(CHAT_THREAD_CONTEXT_SCHEMA_SQL);
  },
  down: () => {
    getDb().exec(DROP_CHAT_THREAD_CONTEXT_SCHEMA_SQL);
  },
};
