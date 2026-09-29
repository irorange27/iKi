import type { LanguageModel, ModelMessage } from 'ai';

import type { AgentStep, ModelInferenceRecord } from '@iki/backend/agent/agent_step';
import type { AgentTool, AgentUsage, ToolApprovalRequest, AgentResult, AgentTurnPerf } from '@iki/backend/agent/types';
import type { ApprovalPolicy } from './tool_resolver';

// ── Harness configuration ─────────────────────────────────────────────

export type HarnessConfig = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  enabledToolNames: string[];
  availableSkillIds: string[];
  guardActive: boolean;
  /** Whether guard requires explicit tool approval. Defaults to guardActive. */
  requireApproval?: boolean;
  /** Bypass approval for tools when user has opted in globally. */
  autoApproveToolRequests?: boolean;
  /** ADR 005: session/turn-level approval policy. Overrides guard flags. */
  approvalPolicy?: ApprovalPolicy;
  maxIterations: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  /** Reasoning-effort override forwarded to the provider call (e.g. 'low' | 'medium' | 'high'). */
  reasoningEffort?: string;
  threadId?: string;
  /** Inject a custom model (FauxModelProvider in tests). */
  modelFactory?: (providerType: string, modelId: string, providerId: string) => LanguageModel;
};

// ── Turn input / output ───────────────────────────────────────────────

export type TurnInput = {
  prompt: string;
  history?: ModelMessage[];
  /** Pre-resolved tools (used by DelegatedAgentTool). */
  toolsOverride?: AgentTool[];
  /** Persistable model facts are returned to the orchestration owner. */
  onInference?: (record: ModelInferenceRecord) => void;
  abortSignal?: AbortSignal;
};

export type TurnOutput = {
  text: string;
  usage?: AgentUsage;
  /** Billed input of the final SDK step — the real context size the model last saw. */
  lastStepInputTokens?: number;
  /** Wall-clock perf metrics measured by the runner (llm/tool time, TTFT, steps). */
  perf?: AgentTurnPerf;
  /** Estimated tokens of the resolved tool schemas sent with the request. */
  toolSchemaTokens?: { builtin: number; mcp: number };
  toolCalls?: AgentResult['toolCalls'];
  requiresApproval: boolean;
  finishReason?: string;
  toolApprovalRequests?: ToolApprovalRequest[];
  handoff?: {
    summary: string;
    nextSteps: string;
    reason: string;
  };
};

// ── Turn event ────────────────────────────────────────────────────────

/** Each yield is either an AgentStep to forward, or the final result. */
export type TurnEvent =
  | { event: 'step'; step: AgentStep }
  | { event: 'done'; output: TurnOutput };
