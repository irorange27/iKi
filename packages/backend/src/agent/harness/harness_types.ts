import type { LanguageModel, ModelMessage } from 'ai';

import type { AgentStep } from '@iki/core/agent/agent_step';
import type { AgentTool, AgentUsage, ToolApprovalRequest, AgentResult } from '@iki/core/agent/types';
import type { AgentRunTracker } from '../../agent/run_tracker';

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
  maxIterations: number;
  maxOutputTokens?: number;
  threadId?: string;
  /** AI SDK prepareStep callback — composed from plan + todo steps. */
  prepareStep?: Record<string, unknown>;
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

// ── Internal session store ────────────────────────────────────────────

export interface SessionStore {
  getHistory(): ModelMessage[];
  syncHistory(messages: ModelMessage[]): void;
  getRunTracker(): AgentRunTracker | null;
  createRunTracker(params: {
    threadId?: string;
    kind: string;
    runRoot?: unknown;
    provider?: string;
    model?: string;
    iterationLimit?: number;
  }): AgentRunTracker;
  updateRunTracker(result: TurnOutput): void;
}
