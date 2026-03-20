export type TodoItemStatus = 'pending' | 'completed';

export interface TodoItem {
  id: string;
  list_id: string;
  content: string;
  notes?: string | null;
  status: TodoItemStatus;
  sort_order: number;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodoListSummary {
  id: string;
  title: string;
  summary?: string | null;
  item_count: number;
  completed_count: number;
  pending_count: number;
  created_at: string;
  updated_at: string;
}

export interface TodoList extends TodoListSummary {
  items: TodoItem[];
}

export interface TodoListItemDraft {
  content: string;
  notes?: string | null;
  completed?: boolean;
}
