/**
 * The session log, backed by the append-only JSONL store.
 *
 * All exported names and signatures are unchanged, so the 13 call sites and the
 * IPC surface stay as they were. The SQL implementation and its migration history
 * are gone: a conversation is a file, opened whole and folded in memory — the same
 * shape pi uses for its interactive sessions.
 */

import path from 'node:path';
import { storeRoot } from '@iki/store/collection';
import {
  createJsonlSessionLogStore,
  type NewSessionEvent,
  type SessionEventMatch,
  type SessionLogStore,
  type StoredSessionEvent,
} from './session_log_store';

export type { NewSessionEvent, StoredSessionEvent };

let cachedRoot = '';
let cachedStore: SessionLogStore | null = null;

const store = (): SessionLogStore => {
  const root = storeRoot();
  if (!cachedStore || cachedRoot !== root) {
    cachedRoot = root;
    cachedStore = createJsonlSessionLogStore(path.join(root, 'sessions'));
  }
  return cachedStore;
};

export const getSessionEvents = (
  threadId: string,
  types?: readonly string[],
  match?: SessionEventMatch
): StoredSessionEvent[] => store().readThread(threadId, types, match);

export const deleteSessionEvents = (threadId: string): void => store().deleteThread(threadId);

export const forkSessionEvents = (
  sourceThreadId: string,
  targetThreadId: string,
  upToRevision?: number
): number => store().forkThread(sourceThreadId, targetThreadId, upToRevision);

export const getSessionEventRevision = (threadId: string): number => store().headRevision(threadId);

export const insertSessionEventsAtHead = (
  threadId: string,
  events: NewSessionEvent[]
): number => store().append(threadId, null, events) ?? store().headRevision(threadId);

export const appendSessionEvents = (
  threadId: string,
  expectedRevision: number,
  events: NewSessionEvent[]
): number | null => store().append(threadId, expectedRevision, events);

export const appendSessionFacts = (threadId: string, events: NewSessionEvent[]): number =>
  store().append(threadId, null, events) ?? store().headRevision(threadId);

export const findMessageEvent = (
  messageId: string,
  threadId?: string
): { threadId: string; payload: unknown } | null => store().findMessage(messageId, threadId);
