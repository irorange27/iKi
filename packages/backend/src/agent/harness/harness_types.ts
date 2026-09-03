import type { LanguageModel, ModelMessage } from 'ai';

import type { AgentStep } from '@iki/backend/agent/agent_step';
import type { AgentTool, AgentUsage, ToolApprovalRequest, AgentResult } from '@iki/backend/agent/types';
import type { AgentRunTracker } from '../../agent_session/run_tracker';

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
  maxIterations: number;
  maxOutputTokens?: number;
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
  /** Optional run tracker (harness owns lifecycle, caller provides instance). */
  runTracker?: AgentRunTracker;
  abortSignal?: AbortSignal;
};

export type TurnOutput = {
  text: string;
  usage?: AgentUsage;
  toolCalls?: AgentResult['toolCalls'];
  requiresApproval: boolean;
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
