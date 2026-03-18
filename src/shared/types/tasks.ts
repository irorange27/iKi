export type ProactiveTaskScheduleType = 'interval' | 'cron';
export type ProactiveTaskStatus = 'idle' | 'running' | 'success' | 'error';

export interface ProactiveTask {
  id: string;
  name: string;
  prompt: string;
  schedule_type: ProactiveTaskScheduleType;
  interval_minutes: number;
  cron_expression?: string | null;
  schedule_timezone?: string | null;
  enabled: boolean;
  provider_type: string;
  model: string;
  tools?: string | null; // JSON string, default null
  thread_id?: string | null;
  notify: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: ProactiveTaskStatus | null;
  last_output?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}
