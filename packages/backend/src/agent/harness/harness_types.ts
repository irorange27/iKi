import type { ModelMessage } from '@iki/backend/message/model_history';

import type { AgentStep, ModelInferenceRecord } from '@iki/backend/agent/agent_step';
import type {
  AgentTool,
  AgentUsage,
  ToolApprovalRequest,
  AgentResult,
  AgentTurnPerf,
} from '@iki/backend/agent/types';
import type { ApprovalPolicy } from './tool_resolver';

export type HarnessConfig = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  enabledToolNames: string[];
  availableSkillIds: string[];
  requireApproval?: boolean;

  autoApproveToolRequests?: boolean;

  approvalPolicy?: ApprovalPolicy;
  maxIterations: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;

  reasoningEffort?: string;
  threadId?: string;
};

export type InlineExecutionRecord = {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  output: unknown;
};

/**
 * What an approval-gated tool call came back as, across the harness/session boundary.
 *
 * The harness receives it through an injected port and may not import thread_session
 * (dependency rule R3); the session produces it. It lives at the boundary because both
 * sides need one definition — two hand-kept copies drift, and the drift shows up as a
 * call the harness believed had an outcome when the journal said it never decided one.
 */
export type ToolExecutionInterruption = {
  code: 'tool-execution-interrupted';
  message: string;
  storedReplay: 'safe' | 'unsafe';
  declaredReplay: 'safe' | 'unsafe';
};

export type ToolExecutionOutcome =
  | { kind: 'pending' | 'unknown' | 'busy' }
  | {
      kind: 'completed';
      reused: boolean;
      result: { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown };
      interrupted?: ToolExecutionInterruption;
    };

export type TurnInput = {
  prompt: string;
  history?: ModelMessage[];

  toolsOverride?: AgentTool[];

  runId?: string;

  recordInlineExecution?: (execution: InlineExecutionRecord) => void;

  onInference?: (record: ModelInferenceRecord) => void;
  abortSignal?: AbortSignal;
};

export type TurnOutput = {
  text: string;
  usage?: AgentUsage;

  lastStepInputTokens?: number;

  perf?: AgentTurnPerf;

  toolSchemaTokens?: { builtin: number; mcp: number };
  toolCalls?: AgentResult['toolCalls'];

  pendingToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  requiresApproval: boolean;
  finishReason?: string;
  toolApprovalRequests?: ToolApprovalRequest[];
};

export type TurnEvent = { event: 'step'; step: AgentStep } | { event: 'done'; output: TurnOutput };

export type TurnDriverHarness = {
  turn(input: TurnInput): AsyncGenerator<TurnEvent, void>;
  getHistory(): ModelMessage[];
};
