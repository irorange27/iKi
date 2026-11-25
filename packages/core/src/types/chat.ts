import type { ApprovalPolicy } from '../utils/action_risk';

/** How a thread runs: plain chat, or chat bound to a work workspace. */
export type ThreadWorkMode = 'chat' | 'work';

export interface ThreadSkillReminderAnchor {
  beforeAnchor: string;
  text: string;
}

export interface ThreadSkillsSnapshot {
  baselinePrompt: string;
  lastDelivered: Record<string, string>;
  anchoredReminders: ThreadSkillReminderAnchor[];
}

export interface ChatThread {
  id: string;
  title: string;
  /** The thread's model binding — what the last turn used. */
  model?: string;
  provider_type?: string | null;
  provider_id?: string | null;
  is_generating: boolean;
  reasoning_effort?: string;
  /** Per-thread run settings. These used to hide inside a stringified JSON
   *  `metadata` blob; each is now a field the compiler can see. */
  work_mode?: ThreadWorkMode;
  approval_policy?: ApprovalPolicy | null;
  personality?: string | null;
  created_at: string;
  updated_at: string;
  client_id?: string;
  prompt_app_id?: string;
  is_favorited: boolean;
  is_incognito: boolean;
  workspace_id?: string;
  enable_artifacts: boolean;
  artifact_workspace_id?: string;
  skill_ids?: string[] | null;
  skills_snapshot?: ThreadSkillsSnapshot | null;
}

// There is no `ChatMessage` row type any more (task-1 / ADR-008). The session log
// (`thread_session/session_log.ts: rebuildThreadViewFromEvents`) is the one rebuild
// of a thread's conversation, and both readers — the renderer's message list and a
// resumed turn's replay input — take the same `ChatUiMessage` value from it. The old
// row shape (parent_id / slot_id / depth / metadata / message-as-JSON-string) only
// existed so one projection could hand a fake SQL row to the renderer, which
// re-parsed the string back into the object it already had. `ChatThread.metadata`
// met the same fate in 2026-11: its four real keys are now fields.

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
  model?: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  reasoning_effort?: string;
  expects_image_result: boolean;
  is_incognito: boolean;
  shortcut?: string;
  window_width?: number;
  window_height?: number;
  font_size?: number;
}

export type ThreadContentMatch = {
  threadId: string;
  threadTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  updatedAt: string;
};
