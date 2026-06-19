import { DEFAULT_APP_CONFIG } from '@iki/backend/config/defaults';
import type { ChatContextMode } from '@iki/backend/chat/intervention_policy';
import type { AffectState } from '@iki/core/emotion/affect_state';
import type { ModelCapability } from '@iki/core/utils/provider_models';
import type { SkillSummary } from '@iki/backend/types/skill';
import type { ChatInputMessage } from './types';
import type { EffectiveContextConfig } from './context_budget';

export type ContextBlockKind =
  | 'recent-history'
  | 'identity'
  | 'thread-summary'
  | 'memory'
  | 'affect'
  | 'skills'
  | 'clipboard';

export type ContextBlockStatus = 'included' | 'truncated' | 'dropped';

export type ContextReportBlock = {
  kind: ContextBlockKind;
  status: ContextBlockStatus;
  estimatedTokens: number;
  charCount: number;
  reason?: string;
  sourceCount?: number;
};

export type ContextReport = {
  totalEstimatedTokens: number;
  retainedRecentMessages: number;
  compactedMessages: number;
  blocks: ContextReportBlock[];
};

export type AssembleChatContextResult = {
  messages: ChatInputMessage[];
  usedSkills: SkillSummary[];
  skillMode: 'manual' | 'auto';
  report: ContextReport;
  effectiveContextConfig: EffectiveContextConfig;
};

export type ThreadSummaryState = {
  summary: string;
  coveredMessageCount: number;
  sourceMessageCount: number;
  stale: boolean;
};

export type ContextConfig = typeof DEFAULT_APP_CONFIG.memory.context;

export type AssembleChatContextParams = {
  messages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  contextMode?: ChatContextMode;
  includeMemory?: boolean;
  modelCapability?: ModelCapability | null;
  affectState?: AffectState | null;
  affectContextMode?: 'default' | 'disabled';
  realtimeAffectMessage?: string;
  onMemoryRetrieved?: (payload: {
    query: string;
    results: Array<Record<string, unknown>>;
    systemMessage: string;
  }) => void;
};

export type RecentHistoryContext = {
  systemMessages: ChatInputMessage[];
  recentMessages: ChatInputMessage[];
  compactedMessages: number;
  block: ContextReportBlock;
};

export type ConversationChunk = {
  messages: ChatInputMessage[];
  preserveAtomically: boolean;
};

export type SummaryContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

export type IdentityContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

export type MemoryContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

export type SkillContext = {
  systemMessage: string;
  usedSkills: SkillSummary[];
  skillMode: 'manual' | 'auto';
  block: ContextReportBlock;
};

export type ClipboardContext = {
  systemMessage: string;
  block: ContextReportBlock;
};
