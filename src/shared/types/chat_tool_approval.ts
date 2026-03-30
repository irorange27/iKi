export type ChatToolApprovalDecision = 'approved' | 'rejected';

export type ChatToolApprovalState = 'pending' | 'answered' | 'consumed';

export interface ChatToolApprovalSession {
  session_id: string;
  thread_id: string;
  assistant_message_id: string;
  provider_type: string;
  model: string;
  system_prompt: string;
  max_output_tokens?: number | null;
  max_iterations?: number | null;
  enabled_tools: string; // JSON string
  available_skill_ids: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface ChatToolApproval {
  approval_id: string;
  session_id: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_args?: string | null; // JSON string
  state: ChatToolApprovalState;
  decision?: ChatToolApprovalDecision | null;
  decision_reason?: string | null;
  responded_at?: string | null;
  created_at: string;
  updated_at: string;
}
