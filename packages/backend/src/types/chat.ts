export interface ChatThread {
  id: string;
  title: string;
  model?: string;
  is_generating: boolean;
  reasoning_effort?: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  client_id?: string;
  prompt_app_id?: string;
  tools?: string;
  is_favorited: number;
  is_incognito: number;
  workspace_id?: string;
  enable_artifacts: number;
  artifact_workspace_id?: string;
  skill_ids?: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  parent_id?: string;
  slot_id?: string;
  depth: number;
  message: string;
  timestamp: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  path: string;
  name: string;
  is_temporary: number;
  show_in_list: number;
  created_at: string;
  updated_at: string;
}

export interface PromptApp {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  prompt_template: string;
  placeholders: string;
  model?: string;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tools?: string;
  reasoning_effort?: string;
  expects_image_result: number;
  is_incognito: number;
  shortcut?: string;
  window_width?: number;
  window_height?: number;
  font_size?: number;
}
