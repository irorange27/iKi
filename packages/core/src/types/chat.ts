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
  is_favorited: boolean;
  is_incognito: boolean;
  workspace_id?: string;
  enable_artifacts: boolean;
  artifact_workspace_id?: string;
  skill_ids?: string;
}

// There is no `ChatMessage` row type any more (task-1 / ADR-008). The session log
// (`thread_session/session_log.ts: rebuildThreadViewFromEvents`) is the one rebuild
// of a thread's conversation, and both readers — the renderer's message list and a
// resumed turn's replay input — take the same `ChatUiMessage` value from it. The old
// row shape (parent_id / slot_id / depth / metadata / message-as-JSON-string) only
// existed so one projection could hand a fake SQL row to the renderer, which
// re-parsed the string back into the object it already had.

export interface Workspace {
  id: string;
  path: string;
  name: string;
  is_temporary: boolean;
  show_in_list: boolean;
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
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tools?: string;
  reasoning_effort?: string;
  expects_image_result: boolean;
  is_incognito: boolean;
  shortcut?: string;
  window_width?: number;
  window_height?: number;
  font_size?: number;
}
