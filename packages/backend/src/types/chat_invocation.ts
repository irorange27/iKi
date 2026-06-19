import type { ModelCapabilitySnapshot } from '@iki/core/types/provider';
import type { ChatExperimentalContext } from '../chat/intervention_policy';

export type ChatInvocationOptions = {
  providerType: string;
  providerId?: string;
  model: string;
  modelCapability?: ModelCapabilitySnapshot;
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
};
