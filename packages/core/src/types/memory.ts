export interface ShortMemoryEntry {
  id: string;
  thread_id: string;
  message_id: string;
  role: string;
  content: string;
  emotion: string | null;
  importance: number;
  created_at: string;
  updated_at: string;
}

export interface LongMemoryEntry {
  id: string;
  thread_id: string;
  summary: string;
  embedding: string;
  source_message_ids: string | null;
  emotion: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface LongMemorySearchResult extends LongMemoryEntry {
  score: number;
}

export interface AffectStateEntry {
  thread_id: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface ThreadContextEntry {
  thread_id: string;
  summary: string;
  covered_message_count: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
