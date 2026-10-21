import { DEFAULT_APP_CONFIG } from '@iki/backend/config/defaults';
import type { ChatContextMode } from '@iki/backend/message/chat_context_mode';
import type { AppConfig } from '@iki/backend/types/config';
import type { ModelMessage } from '../message/model_history';
import type { ModelCapability } from '@iki/backend/utils/provider_models';
import type { SkillSummary } from '@iki/backend/types/skill';
import type { EffectiveContextConfig } from './context_budget';

export type {
  ContextCompositionCategory,
  ContextCompositionSummary,
} from '@iki/backend/types/context_composition';

type ChatInputMessage = ModelMessage;

export type ContextBlockKind = 'recent-history' | 'identity' | 'thread-summary' | 'skills';

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

export type ContextConfig = typeof DEFAULT_APP_CONFIG.context;

export type AssembleChatContextParams = {
  messages: ChatInputMessage[];
  threadId?: string;
  /**
   * Explicit turn-start workspace world (D30). When present — including an
   * explicit null, meaning the turn started with no workspace — the workspace
   * system message and project instructions are derived from it instead of
   * re-resolving the thread's CURRENT selection. Undefined keeps the legacy
   * fresh-resolution for callers without a frozen world.
   */
  workspaceSelection?: import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  contextMode?: ChatContextMode;
  modelCapability?: ModelCapability | null;
  contextBudgetOverride?: AppConfig['context'] | null;
};

export type RecentHistoryContext = {
  systemMessages: ChatInputMessage[];
  recentMessages: ChatInputMessage[];
  compactedMessages: number;
  block: ContextReportBlock;
};

export type IdentityContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

export type SkillContext = {
  systemMessage: string;
  usedSkills: SkillSummary[];
  skillMode: 'manual' | 'auto';
  block: ContextReportBlock;
};
