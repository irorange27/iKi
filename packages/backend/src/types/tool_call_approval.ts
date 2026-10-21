export type ToolCallApprovalDecision = 'approved' | 'rejected';

export type ToolCallApprovalState = 'pending' | 'answered' | 'consumed';

export interface ToolCallApprovalSession {
  session_id: string;
  thread_id: string;
  assistant_message_id: string;
  run_id?: string | null;
  provider_type: string;
  provider_id?: string | null;
  model: string;
  system_prompt: string;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  max_iterations?: number | null;
  enabled_tools: string;
  available_skill_ids: string;

  workspace_selection?: string | null;

  plan_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCallApproval {
  approval_id: string;
  session_id: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_args?: string | null;
  state: ToolCallApprovalState;
  decision?: ToolCallApprovalDecision | null;
  decision_reason?: string | null;
  responded_at?: string | null;
  created_at: string;
  updated_at: string;
}
