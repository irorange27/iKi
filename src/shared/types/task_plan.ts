export type TaskPlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskPlanItemDraft {
  id?: string | null;
  text: string;
  status?: TaskPlanItemStatus | null;
}

export interface TaskPlanItem {
  id: string;
  text: string;
  status: TaskPlanItemStatus;
}

export interface TaskPlan {
  thread_id: string;
  items: TaskPlanItem[];
  created_at: string;
  updated_at: string;
}
