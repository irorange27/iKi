import db from './database';
import { ChatMessage } from '../../shared/types/chat';

export const getChatMessages = (threadId: string): ChatMessage[] => {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY timestamp ASC')
    .all(threadId) as any[];
  return rows;
};

export const getChatMessage = (id: string): ChatMessage | null => {
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as any;
  if (!row) return null;
  return row;
};

export const getChatMessagesByParent = (parentId: string): ChatMessage[] => {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE parent_id = ? ORDER BY timestamp ASC')
    .all(parentId) as any[];
  return rows;
};

export const getChatMessagesBySlot = (slotId: string): ChatMessage[] => {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE slot_id = ? ORDER BY timestamp ASC')
    .all(slotId) as any[];
  return rows;
};

export const getChatMessagesByDepth = (threadId: string, depth: number): ChatMessage[] => {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE thread_id = ? AND depth = ? ORDER BY timestamp ASC')
    .all(threadId, depth) as any[];
  return rows;
};

export const addChatMessage = (
  message: Partial<ChatMessage> & {
    id: string;
    thread_id: string;
    message: string;
    timestamp: string;
    metadata: string;
  }
) => {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
        INSERT INTO chat_messages (
            id, thread_id, parent_id, slot_id, depth, message, timestamp, metadata, created_at, updated_at
        ) VALUES (
            @id, @thread_id, @parent_id, @slot_id, @depth, @message, @timestamp, @metadata, @created_at, @updated_at
        )
    `);

  const data = {
    id: message.id,
    thread_id: message.thread_id,
    parent_id: message.parent_id || null,
    slot_id: message.slot_id || null,
    depth: message.depth || 0,
    message: message.message,
    timestamp: message.timestamp,
    metadata: message.metadata,
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

export const updateChatMessage = (id: string, message: Partial<ChatMessage>) => {
  const now = new Date().toISOString();
  const fields = Object.keys(message)
    .filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at')
    .map(key => `${key} = @${key}`)
    .join(', ');

  if (!fields) return null;

  const stmt = db.prepare(`
        UPDATE chat_messages 
        SET ${fields}, updated_at = @updated_at 
        WHERE id = @id
    `);

  const params: any = { ...message, id, updated_at: now };

  return stmt.run(params);
};

export const deleteChatMessage = (id: string) => {
  return db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
};

export const deleteChatMessagesByThread = (threadId: string) => {
  return db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(threadId);
};

export const deleteChatMessagesByParent = (parentId: string) => {
  return db.prepare('DELETE FROM chat_messages WHERE parent_id = ?').run(parentId);
};
