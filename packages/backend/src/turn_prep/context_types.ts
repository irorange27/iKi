import { DEFAULT_APP_CONFIG } from '@iki/backend/config/defaults';
import type { ChatContextMode } from '@iki/backend/message/intervention_policy';
import type { AffectState } from '@iki/backend/affect/affect_state';
import type { AppConfig } from '@iki/backend/types/config';
import type { ModelMessage } from 'ai';
import type { ModelCapability } from '@iki/backend/utils/provider_models';
import type { SkillSummary } from '@iki/backend/types/skill';
import type { EffectiveContextConfig } from './context_budget';

export type {
  ContextCompositionCategory,
  ContextCompositionSummary,
} from '@iki/backend/types/context_composition';

type ChatInputMessage = ModelMessage;

export type ContextBlockKind =
  | 'recent-history'
  | 'identity'
  | 'thread-summary'
  | 'memory'
  | 'affect'
  | 'skills';

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


export type ContextConfig = typeof DEFAULT_APP_CONFIG.memory.context;

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
  includeMemory?: boolean;
  modelCapability?: ModelCapability | null;
  affectState?: AffectState | null;
  affectContextMode?: 'default' | 'disabled';
  realtimeAffectMessage?: string;
  memoryContextConfig?: AppConfig['memory']['context'] | null;
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
