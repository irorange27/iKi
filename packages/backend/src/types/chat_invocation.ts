import type { ModelCapabilitySnapshot } from '@iki/backend/types/provider';
import type { ChatExperimentalContext } from '../chat/intervention_policy';

export type ChatInvocationOptions = {
  providerType: string;
  providerId?: string;
  model: string;
  modelCapability?: ModelCapabilitySnapshot;
  /** Per-thread reasoning effort override ('low' | 'medium' | 'high'); empty/omitted = provider default. */
  reasoningEffort?: string;
  /** Per-thread agent personality ('default' | 'concise' | 'friendly'). */
  personality?: string;
  /** Session-level tool approval policy; overrides the global auto-approve switch. */
  approvalPolicy?: string;
  messages: unknown[];
  tools?: string[];
  mcpServerIds?: string[];
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  threadId?: string;
  maxIterations?: number;
  autonomous?: {
    maxIterations: number;
    continuePrompt?: string;
  };
  experimentalContext?: ChatExperimentalContext;
};

export type ChatInvocationResult = {
  success?: boolean;
  error?: string;
  /** Approval resume: the decision was recorded but sibling approvals remain. */
  awaitingApproval?: boolean;
  waitingForApprovals?: string[];
};
