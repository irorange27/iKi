/**
 * ATIF (Agent Trajectory Interchange Format, v1.8) wire types, shared by the
 * exporter (thread_session/atif_export.ts), the UI trajectory viewer and the
 * electron_api surface. Kept dependency-free so renderer code can import them.
 */

export type AtifToolCall = {
  tool_call_id: string;
  function_name: string;
  arguments?: unknown;
};

export type AtifObservation = {
  results: Array<{
    source_call_id: string;
    content: unknown;
  }>;
};

export type AtifMetrics = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  cost_usd?: number;
};

export type AtifStep = {
  step_id: number;
  timestamp: string;
  source: 'system' | 'user' | 'agent';
  model_name?: string;
  message?: string;
  reasoning_content?: string;
  tool_calls?: AtifToolCall[];
  observation?: AtifObservation;
  metrics?: AtifMetrics;
  extra?: Record<string, unknown>;
};

export type AtifTrajectory = {
  schema_version: 'ATIF-v1.8';
  session_id?: string;
  trajectory_id?: string;
  agent: {
    name: string;
    version?: string;
    model_name?: string;
    extra?: Record<string, unknown>;
  };
  steps: AtifStep[];
  final_metrics?: {
    total_prompt_tokens?: number;
    total_completion_tokens?: number;
    total_cached_tokens?: number;
    total_cost_usd?: number;
    total_steps?: number;
  };
  extra?: Record<string, unknown>;
};

export type AtifTrajectoryExportResult = {
  success: boolean;
  trajectory?: AtifTrajectory;
  errors?: string[];
};
