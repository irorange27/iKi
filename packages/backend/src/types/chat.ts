export interface ChatThread {
  id: string;
  title: string;
  model?: string;
  is_generating: boolean;
  reasoning_effort?: string;
  metadata: string; // JSON string
  created_at: string;
  updated_at: string;
  client_id?: string;
  prompt_app_id?: string;
  tools?: string; // JSON string
  is_favorited: number; // 0 or 1
  is_incognito: number; // 0 or 1
  workspace_id?: string;
  enable_artifacts: number; // 0 or 1
  artifact_workspace_id?: string;
  skill_ids?: string; // JSON string
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  parent_id?: string;
  slot_id?: string;
  depth: number;
  message: string; // JSON string
  timestamp: string;
  metadata: string; // JSON string
  created_at: string;
  updated_at: string;
}

export type {
  ChatToolApproval,
  ChatToolApprovalDecision,
  ChatToolApprovalSession,
  ChatToolApprovalState,
} from './chat_tool_approval';

export interface Workspace {
  id: string;
  path: string;
  name: string;
  is_temporary: number; // 0 or 1
  show_in_list: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface PromptApp {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  prompt_template: string;
  placeholders: string; // JSON string, default '[]'
  model?: string;
  enabled: number; // 0 or 1
  sort_order: number;
  created_at: string;
  updated_at: string;
  tools?: string; // JSON string
  reasoning_effort?: string;
  expects_image_result: number; // 0 or 1
  is_incognito: number; // 0 or 1
  shortcut?: string;
  window_width?: number;
  window_height?: number;
  font_size?: number;
}
