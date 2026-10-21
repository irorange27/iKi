import type { ModelCapabilitySnapshot } from '@iki/backend/types/provider';
import type { ChatExperimentalContext } from '../message/chat_context_mode';

export type ChatInvocationOptions = {
  providerType: string;
  providerId?: string;
  model: string;
  modelCapability?: ModelCapabilitySnapshot;

  reasoningEffort?: string;

  personality?: string;

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

  awaitingApproval?: boolean;
  waitingForApprovals?: string[];
};
