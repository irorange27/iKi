import { type ModelMessage } from 'ai';

import { getAppConfig } from '../../../core/config';
import * as chatMessageDb from '../../../core/db/chat_message';
import * as threadContextDb from '../../../core/db/thread_context';
import * as memoryDb from '../../../core/db/memory';
import {
  extractTextFromModelMessageContent,
  hasToolPartInModelMessageContent,
  sanitizeModelConversationMessages,
} from '../../../core/agent/model_messages';
import {
  clipTextToTokenBudget,
  estimateMessageTokens,
  estimateTextTokens,
} from '../../../core/context/token_estimator';
import {
  generateThreadSummary,
  type ThreadSummaryMessage,
} from '../../../core/context/thread_summary';
import type { AffectState } from '../../../core/emotion/affect_state';
import { DEFAULT_APP_CONFIG } from '../../../shared/config/defaults';
import type { ChatContextMode } from '../../../shared/chat/intervention_policy';
import type { ModelCapability } from '../../../shared/utils/provider_models';
import { normalizeWhitespace } from '../../../shared/utils/text';
import type { ChatInputMessage } from './chat_types';
import type { ChatMemory } from './chat_memory';
import { deriveModelAwareContextConfig, type EffectiveContextConfig } from './chat_context_budget';
import { resolveSkillsSystemPrompt } from './chat_skills';
import { getPromptFromMessage } from './chat_ui';
import {
  getAssistantProfileContextMessage,
  retrieveRelevantContinuity,
  shouldUseLegacyContinuityContextBlocks,
} from '../continuity/continuity_service';
import { getPresenceContextMessage } from '../presence/presence_runtime';
import { getRecentRuntimeReflectionContextMessage } from '../presence/presence_reflection';

export type ContextBlockKind =
  | 'recent-history'
  | 'identity'
  | 'presence-state'
  | 'runtime-reflection'
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

type AssembleChatContextResult = {
  messages: ChatInputMessage[];
  usedSkills: Awaited<ReturnType<typeof resolveSkillsSystemPrompt>>['usedSkills'];
  skillMode: 'manual' | 'auto';
  report: ContextReport;
  effectiveContextConfig: EffectiveContextConfig;
};

type ThreadSummaryState = {
  summary: string;
  coveredMessageCount: number;
  sourceMessageCount: number;
  stale: boolean;
};

type ContextConfig = typeof DEFAULT_APP_CONFIG.memory.context;

type AssembleChatContextParams = {
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

type RecentHistoryContext = {
  systemMessages: ChatInputMessage[];
  recentMessages: ChatInputMessage[];
  compactedMessages: number;
  block: ContextReportBlock;
};

type ConversationChunk = {
  messages: ChatInputMessage[];
  preserveAtomically: boolean;
};

type SummaryContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

type IdentityContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

type PresenceStateContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

type RuntimeReflectionContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

type MemoryContext = {
  systemMessage: string;
  block: ContextReportBlock;
};

type SkillContext = {
  systemMessage: string;
  usedSkills: Awaited<ReturnType<typeof resolveSkillsSystemPrompt>>['usedSkills'];
  skillMode: 'manual' | 'auto';
  block: ContextReportBlock;
};

const getContextConfig = (): ContextConfig => {
  const configured = getAppConfig()?.memory?.context;
  return {
    ...DEFAULT_APP_CONFIG.memory.context,
    ...(configured ?? {}),
  };
};

const countMessageTokens = (
  message: ChatInputMessage,
  modelCapability?: ModelCapability | null
): number => estimateMessageTokens(message, modelCapability);

const clipMessageToBudget = (
  message: ChatInputMessage,
  maxTokens: number,
  modelCapability?: ModelCapability | null
): { message: ChatInputMessage; truncated: boolean } => {
  if (maxTokens <= 0) return { message, truncated: false };

  if (message.role === 'tool') {
    return { message, truncated: false };
  }

  if (typeof message.content === 'string') {
    const clipped = clipTextToTokenBudget(message.content, maxTokens, modelCapability);
    return clipped.truncated
      ? { message: { ...message, content: clipped.text }, truncated: true }
      : { message, truncated: false };
  }

  if (
    Array.isArray(message.content) &&
    message.content.every(
      part =>
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
  ) {
    const clipped = clipTextToTokenBudget(
      extractTextFromModelMessageContent(message.content),
      maxTokens,
      modelCapability
    );
    return clipped.truncated
      ? { message: { ...message, content: clipped.text }, truncated: true }
      : { message, truncated: false };
  }

  return { message, truncated: false };
};

const buildMessagePreview = (message: ChatInputMessage): string => {
  if (typeof message.content === 'string') return message.content;
  if (message.role === 'tool') return JSON.stringify(message.content ?? {});
  return extractTextFromModelMessageContent(message.content);
};

const toStoredThreadSummaryMessages = (threadId: string): ThreadSummaryMessage[] =>
  chatMessageDb
    .getChatMessages(threadId)
    .map(row => memoryDb.extractTextFromMessageJson(row.message))
    .filter(
      (entry): entry is { role: string; content: string } =>
        Boolean(entry) &&
        (entry?.role === 'user' || entry?.role === 'assistant') &&
        typeof entry?.content === 'string' &&
        entry.content.trim().length > 0
    )
    .map(entry => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: entry.content,
    }));

const ensureThreadSummary = async (
  threadId: string,
  contextConfig: ContextConfig
): Promise<ThreadSummaryState | null> => {
  if (!threadId || !contextConfig.enabled) return null;

  const messages = toStoredThreadSummaryMessages(threadId);
  if (messages.length < Math.max(1, contextConfig.summaryTriggerMessages)) {
    threadContextDb.deleteThreadContext(threadId);
    return null;
  }

  const compactableCount = Math.max(
    0,
    messages.length - Math.max(1, contextConfig.summaryRecentMessages)
  );
  if (compactableCount <= 0) {
    threadContextDb.deleteThreadContext(threadId);
    return null;
  }

  const existing = threadContextDb.getThreadContext(threadId);
  const shouldRegenerate =
    !existing ||
    existing.covered_message_count <= 0 ||
    existing.covered_message_count > compactableCount;

  const deltaMessages = shouldRegenerate
    ? messages.slice(0, compactableCount)
    : messages.slice(existing.covered_message_count, compactableCount);

  if (deltaMessages.length === 0) {
    if (!existing?.summary.trim()) return null;
    return {
      summary: existing.summary,
      coveredMessageCount: existing.covered_message_count,
      sourceMessageCount: compactableCount,
      stale: existing.covered_message_count !== compactableCount,
    };
  }

  const generated = await generateThreadSummary({
    existingSummary: shouldRegenerate ? '' : existing?.summary,
    messages: deltaMessages,
  });

  if (!generated) {
    if (!existing?.summary.trim()) return null;
    return {
      summary: existing.summary,
      coveredMessageCount: existing.covered_message_count,
      sourceMessageCount: compactableCount,
      stale: true,
    };
  }

  threadContextDb.upsertThreadContext({
    thread_id: threadId,
    summary: generated.summary,
    covered_message_count: compactableCount,
    metadata: {
      sourceMessageCount: compactableCount,
      model: generated.model,
    },
  });

  return {
    summary: generated.summary,
    coveredMessageCount: compactableCount,
    sourceMessageCount: compactableCount,
    stale: false,
  };
};

const insertSystemMessages = (
  messages: ChatInputMessage[],
  additions: string[]
): ChatInputMessage[] => {
  const nextSystemMessages = additions
    .map(content => content.trim())
    .filter(Boolean)
    .map(content => ({ role: 'system', content }) as ModelMessage);

  if (nextSystemMessages.length === 0) return messages;

  const insertIndex = messages.findIndex(message => message.role !== 'system');
  const headIndex = insertIndex === -1 ? messages.length : insertIndex;
  return [...messages.slice(0, headIndex), ...nextSystemMessages, ...messages.slice(headIndex)];
};

const buildMemorySystemMessage = (
  results: Array<{ summary: string; score: number; updated_at?: string }>
): string => {
  if (!results.length) return '';
  const lines = results.map(entry => {
    const score = Number.isFinite(entry.score) ? entry.score.toFixed(3) : '0.000';
    const dateText = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '';
    const summary = normalizeWhitespace(entry.summary);
    return dateText ? `- (${score}, ${dateText}) ${summary}` : `- (${score}) ${summary}`;
  });
  return ['Long-term memory (use only if relevant; ignore if unrelated):', ...lines].join('\n');
};

const buildConversationChunks = (messages: ChatInputMessage[]): ConversationChunk[] => {
  const chunks: ConversationChunk[] = [];

  for (let index = 0; index < messages.length; ) {
    const currentMessage = messages[index];
    const assistantAnchorsToolExchange =
      currentMessage.role === 'assistant' && hasToolPartInModelMessageContent(currentMessage.content);

    if (assistantAnchorsToolExchange) {
      let nextIndex = index + 1;
      while (nextIndex < messages.length && messages[nextIndex]?.role === 'tool') {
        nextIndex += 1;
      }

      if (nextIndex > index + 1) {
        chunks.push({
          messages: messages.slice(index, nextIndex),
          preserveAtomically: true,
        });
        index = nextIndex;
        continue;
      }
    }

    chunks.push({
      messages: [currentMessage],
      preserveAtomically: false,
    });
    index += 1;
  }

  return chunks;
};

const buildRecentHistoryReason = (params: {
  compactedMessages: number;
  truncatedRecentMessages: number;
  droppedToolMessages: number;
}): string | undefined => {
  const reasons: string[] = [];

  if (params.compactedMessages > 0) {
    reasons.push('compacted older turns');
  }

  if (params.truncatedRecentMessages > 0) {
    reasons.push('clipped oversized recent text');
  }

  if (params.droppedToolMessages > 0) {
    reasons.push('removed orphaned tool messages');
  }

  if (reasons.length === 0) return undefined;
  if (reasons.length === 1) {
    return reasons[0] === 'compacted older turns'
      ? 'compacted older turns into summary/recent window'
      : reasons[0];
  }
  if (reasons.length === 2) {
    if (
      reasons[0] === 'compacted older turns' &&
      reasons[1] === 'clipped oversized recent text'
    ) {
      return 'compacted older turns and clipped oversized recent text';
    }
    return `${reasons[0]} and ${reasons[1]}`;
  }

  return `${reasons[0]}, ${reasons[1]}, and ${reasons[2]}`;
};

const selectRecentHistory = (
  messages: ChatInputMessage[],
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): RecentHistoryContext => {
  const conversationMessages = messages.filter(message => message.role !== 'system');
  const systemMessages = messages.filter(message => message.role === 'system');
  const conversationChunks = buildConversationChunks(conversationMessages);
  const recentMessages: ChatInputMessage[] = [];
  let recentTokens = 0;
  let truncatedRecentMessages = 0;

  for (let chunkIndex = conversationChunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
    const chunk = conversationChunks[chunkIndex];
    const isLatestChunk = chunkIndex === conversationChunks.length - 1;
    const clippedChunkMessages = chunk.messages.map((message, messageIndex) => {
      const isLatestMessageInConversation =
        isLatestChunk && messageIndex === chunk.messages.length - 1;
      return isLatestMessageInConversation
        ? { message, truncated: false }
        : clipMessageToBudget(message, contextConfig.maxMessageTokens, modelCapability);
    });
    const nextMessages = clippedChunkMessages.map(entry => entry.message);
    const nextTokens = nextMessages.reduce(
      (sum, message) => sum + countMessageTokens(message, modelCapability),
      0
    );
    const nextTruncatedCount = clippedChunkMessages.filter(entry => entry.truncated).length;
    const exceedsBudget =
      recentMessages.length > 0 && recentTokens + nextTokens > contextConfig.maxRecentTokens;
    const exceedsCount =
      recentMessages.length > 0 &&
      recentMessages.length + nextMessages.length > Math.max(1, contextConfig.recentMessageCount);

    if (exceedsBudget || exceedsCount) {
      if (!chunk.preserveAtomically) {
        break;
      }

      recentMessages.unshift(...nextMessages);
      recentTokens += nextTokens;
      truncatedRecentMessages += nextTruncatedCount;
      break;
    }

    recentMessages.unshift(...nextMessages);
    recentTokens += nextTokens;
    truncatedRecentMessages += nextTruncatedCount;
  }

  const sanitizedRecentHistory = sanitizeModelConversationMessages(recentMessages);
  const compactedMessages = Math.max(
    0,
    conversationMessages.length - sanitizedRecentHistory.messages.length
  );
  const reason = buildRecentHistoryReason({
    compactedMessages,
    truncatedRecentMessages,
    droppedToolMessages: sanitizedRecentHistory.droppedMessages,
  });
  const sanitizedRecentTokens = sanitizedRecentHistory.messages.reduce(
    (sum, message) => sum + countMessageTokens(message, modelCapability),
    0
  );

  return {
    systemMessages,
    recentMessages: sanitizedRecentHistory.messages,
    compactedMessages,
    block: {
      kind: 'recent-history',
      status:
        compactedMessages > 0 ||
        truncatedRecentMessages > 0 ||
        sanitizedRecentHistory.droppedMessages > 0
          ? 'truncated'
          : 'included',
      estimatedTokens: sanitizedRecentTokens,
      charCount: sanitizedRecentHistory.messages.reduce(
        (sum, message) => sum + buildMessagePreview(message).length,
        0
      ),
      ...(reason ? { reason } : {}),
      sourceCount: sanitizedRecentHistory.messages.length,
    },
  };
};

const buildThreadSummaryContext = (
  threadSummary: ThreadSummaryState | null,
  compactedMessages: number,
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): SummaryContext => {
  const summaryClip = threadSummary?.summary
    ? clipTextToTokenBudget(threadSummary.summary, contextConfig.maxSummaryTokens, modelCapability)
    : { text: '', truncated: false };

  if (threadSummary?.summary) {
    return {
      systemMessage: `Thread summary:\n${summaryClip.text}`,
      block: {
        kind: 'thread-summary',
        status: summaryClip.truncated ? 'truncated' : 'included',
        estimatedTokens: estimateTextTokens(summaryClip.text, modelCapability),
        charCount: summaryClip.text.length,
        ...(summaryClip.truncated ? { reason: 'thread summary clipped to context budget' } : {}),
        sourceCount: threadSummary.sourceMessageCount,
      },
    };
  }

  return {
    systemMessage: '',
    block: {
      kind: 'thread-summary',
      status: 'dropped',
      estimatedTokens: 0,
      charCount: 0,
      reason: compactedMessages > 0 ? 'summary unavailable' : 'thread too short for summarization',
    },
  };
};

const buildIdentityContext = (
  identityMessage: string,
  workspaceMessage: string | undefined,
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): IdentityContext => {
  const combinedMessage = [identityMessage.trim(), workspaceMessage?.trim() ?? '']
    .filter(Boolean)
    .join('\n\n');
  const identityClip = clipTextToTokenBudget(
    combinedMessage,
    contextConfig.maxIdentityTokens,
    modelCapability
  );

  return {
    systemMessage: identityClip.text,
    block: {
      kind: 'identity',
      status: identityClip.text ? (identityClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTextTokens(identityClip.text, modelCapability),
      charCount: identityClip.text.length,
      ...(identityClip.text
        ? identityClip.truncated
          ? { reason: 'identity block clipped to context budget' }
          : {}
        : { reason: 'no active identity profile or workspace scope available' }),
    },
  };
};

const buildPresenceStateContext = (
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): PresenceStateContext => {
  const lifeClip = clipTextToTokenBudget(
    getPresenceContextMessage(),
    contextConfig.maxPresenceStateTokens,
    modelCapability
  );

  return {
    systemMessage: lifeClip.text,
    block: {
      kind: 'presence-state',
      status: lifeClip.text ? (lifeClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTextTokens(lifeClip.text, modelCapability),
      charCount: lifeClip.text.length,
      ...(lifeClip.text
        ? lifeClip.truncated
          ? { reason: 'presence-state block clipped to context budget' }
          : {}
        : { reason: 'no presence state available' }),
    },
  };
};

const buildRuntimeReflectionContext = (
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): RuntimeReflectionContext => {
  const reflectionClip = clipTextToTokenBudget(
    getRecentRuntimeReflectionContextMessage(),
    contextConfig.maxRuntimeReflectionTokens,
    modelCapability
  );

  return {
    systemMessage: reflectionClip.text,
    block: {
      kind: 'runtime-reflection',
      status: reflectionClip.text
        ? reflectionClip.truncated
          ? 'truncated'
          : 'included'
        : 'dropped',
      estimatedTokens: estimateTextTokens(reflectionClip.text, modelCapability),
      charCount: reflectionClip.text.length,
      ...(reflectionClip.text
        ? reflectionClip.truncated
          ? { reason: 'reflection block clipped to context budget' }
          : {}
        : { reason: 'no recent runtime reflection available' }),
    },
  };
};

const toMemoryDisplayEntry = (result: Record<string, unknown>) => ({
  summary: typeof result.summary === 'string' ? result.summary : '',
  score: typeof result.score === 'number' ? result.score : Number(result.score || 0),
  updated_at: typeof result.updated_at === 'string' ? result.updated_at : undefined,
});

const buildDroppedMemoryContext = (reason: string): MemoryContext => ({
  systemMessage: '',
  block: {
    kind: 'memory',
    status: 'dropped',
    estimatedTokens: 0,
    charCount: 0,
    reason,
  },
});

const buildDroppedBlock = (kind: ContextBlockKind, reason: string): ContextReportBlock => ({
  kind,
  status: 'dropped',
  estimatedTokens: 0,
  charCount: 0,
  reason,
});

const buildCombinedMemorySystemMessage = (sections: string[]): string =>
  sections
    .map(section => section.trim())
    .filter(Boolean)
    .join('\n\n');

const buildContinuityMemorySystemMessage = (
  entries: Array<{ summary: string; score: number; updated_at?: string }>
): string => {
  if (!entries.length) return '';
  const lines = entries.map(entry => {
    const score = Number.isFinite(entry.score) ? entry.score.toFixed(3) : '0.000';
    const dateText = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '';
    const summary = normalizeWhitespace(entry.summary);
    return dateText ? `- (${score}, ${dateText}) ${summary}` : `- (${score}) ${summary}`;
  });
  return ['Durable continuity context (use only if relevant):', ...lines].join('\n');
};

const buildMemoryContext = async (params: {
  threadId?: string;
  query: string;
  memory: ChatMemory;
  contextConfig: ContextConfig;
  modelCapability?: ModelCapability | null;
  onMemoryRetrieved?: AssembleChatContextParams['onMemoryRetrieved'];
}): Promise<MemoryContext> => {
  if (!params.query.trim()) {
    return buildDroppedMemoryContext('no user query available');
  }

  const continuityPayload = retrieveRelevantContinuity(params.query);
  const archiveMemoryPayload =
    params.threadId && params.query.trim()
      ? await params.memory.retrieveRelevantMemory(params.threadId, params.query)
      : null;

  if (!continuityPayload && !archiveMemoryPayload) {
    return buildDroppedMemoryContext('no relevant continuity or archive memory retrieved');
  }

  let continuityResults = [...(continuityPayload?.results ?? [])];
  let archiveMemoryResults = [...(archiveMemoryPayload?.results ?? [])];
  const originalResultCount = continuityResults.length + archiveMemoryResults.length;
  let memoryResults = [...continuityResults, ...archiveMemoryResults];
  let memorySystemMessage = buildCombinedMemorySystemMessage([
    continuityResults.length > 0
      ? buildContinuityMemorySystemMessage(continuityResults.map(toMemoryDisplayEntry))
      : '',
    archiveMemoryResults.length > 0
      ? buildMemorySystemMessage(archiveMemoryResults.map(toMemoryDisplayEntry))
      : '',
  ]);

  while (
    memoryResults.length > 1 &&
    estimateTextTokens(memorySystemMessage, params.modelCapability) >
      params.contextConfig.maxMemoryTokens
  ) {
    if (archiveMemoryResults.length > 0) {
      archiveMemoryResults = archiveMemoryResults.slice(0, -1);
    } else {
      continuityResults = continuityResults.slice(0, -1);
    }
    memoryResults = [...continuityResults, ...archiveMemoryResults];
    memorySystemMessage = buildCombinedMemorySystemMessage([
      continuityResults.length > 0
        ? buildContinuityMemorySystemMessage(continuityResults.map(toMemoryDisplayEntry))
        : '',
      archiveMemoryResults.length > 0
        ? buildMemorySystemMessage(archiveMemoryResults.map(toMemoryDisplayEntry))
        : '',
    ]);
  }

  const memoryClip = clipTextToTokenBudget(
    memorySystemMessage,
    params.contextConfig.maxMemoryTokens,
    params.modelCapability
  );
  params.onMemoryRetrieved?.({
    query: continuityPayload?.query || archiveMemoryPayload?.query || params.query,
    results: memoryResults,
    systemMessage: memoryClip.text,
  });

  return {
    systemMessage: memoryClip.text,
    block: {
      kind: 'memory',
      status: memoryClip.text
        ? memoryClip.truncated || memoryResults.length < originalResultCount
          ? 'truncated'
          : 'included'
        : 'dropped',
      estimatedTokens: estimateTextTokens(memoryClip.text, params.modelCapability),
      charCount: memoryClip.text.length,
      ...(memoryClip.text
        ? memoryClip.truncated
          ? { reason: 'memory block clipped to context budget' }
          : memoryResults.length < originalResultCount
            ? { reason: 'continuity or archive memory items reduced to fit context budget' }
            : {}
        : { reason: 'no relevant continuity or archive memory retrieved' }),
      sourceCount: memoryResults.length,
    },
  };
};

const resolveAffectMessage = (
  params: Pick<AssembleChatContextParams, 'affectContextMode' | 'realtimeAffectMessage' | 'threadId'>,
  memory: ChatMemory
): { message: string; droppedReason?: string } => {
  if (params.affectContextMode === 'disabled') {
    return {
      message: '',
      droppedReason: 'disabled for experiment no_affect mode',
    };
  }

  if (params.realtimeAffectMessage?.trim()) {
    return { message: params.realtimeAffectMessage.trim() };
  }

  return {
    message: params.threadId ? memory.getAffectContextMessage(params.threadId) : '',
  };
};

const buildAffectBlock = (
  affectMessage: string,
  modelCapability?: ModelCapability | null,
  droppedReason?: string
): ContextReportBlock => ({
  kind: 'affect',
  status: affectMessage ? 'included' : 'dropped',
  estimatedTokens: estimateTextTokens(affectMessage, modelCapability),
  charCount: affectMessage.length,
  ...(affectMessage ? {} : { reason: droppedReason || 'no affect context available' }),
});

const buildSkillContext = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  affectState?: AffectState | null;
  contextConfig: ContextConfig;
  modelCapability?: ModelCapability | null;
}): Promise<SkillContext> => {
  const { skillsSystemPrompt, usedSkills, skillMode } = await resolveSkillsSystemPrompt({
    inputMessages: params.inputMessages,
    threadId: params.threadId,
    skillIds: params.skillIds,
    skillMode: params.skillMode,
    affectState: params.affectState,
  });
  const skillClip = clipTextToTokenBudget(
    skillsSystemPrompt,
    params.contextConfig.maxSkillTokens,
    params.modelCapability
  );

  return {
    systemMessage: skillClip.text,
    usedSkills,
    skillMode,
    block: {
      kind: 'skills',
      status: skillClip.text ? (skillClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTextTokens(skillClip.text, params.modelCapability),
      charCount: skillClip.text.length,
      ...(skillClip.text
        ? skillClip.truncated
          ? { reason: 'skill context clipped to budget' }
          : {}
        : { reason: 'no skills selected' }),
      sourceCount: usedSkills.length,
    },
  };
};

const buildAssembleResult = (params: {
  messages: ChatInputMessage[];
  usedSkills: Awaited<ReturnType<typeof resolveSkillsSystemPrompt>>['usedSkills'];
  skillMode: 'manual' | 'auto';
  retainedRecentMessages: number;
  compactedMessages: number;
  blocks: ContextReportBlock[];
  effectiveContextConfig: EffectiveContextConfig;
}): AssembleChatContextResult => ({
  messages: params.messages,
  usedSkills: params.usedSkills,
  skillMode: params.skillMode,
  effectiveContextConfig: params.effectiveContextConfig,
  report: {
    totalEstimatedTokens: params.blocks.reduce((sum, block) => sum + block.estimatedTokens, 0),
    retainedRecentMessages: params.retainedRecentMessages,
    compactedMessages: params.compactedMessages,
    blocks: params.blocks,
  },
});

export const createChatContextAssembler = (deps: {
  memory: ChatMemory;
  workspaceSystemMessage?: (threadId?: string) => string;
}) => {
  const assemble = async (
    params: AssembleChatContextParams
  ): Promise<AssembleChatContextResult> => {
    const contextConfig = deriveModelAwareContextConfig(getContextConfig(), params.modelCapability);
    const blocks: ContextReportBlock[] = [];
    const benchmarkCleanContext = params.contextMode === 'benchmark_clean';

    if (!contextConfig.enabled) {
      return buildAssembleResult({
        messages: params.messages,
        usedSkills: [],
        skillMode: params.skillMode === 'auto' ? 'auto' : 'manual',
        retainedRecentMessages: params.messages.filter(message => message.role !== 'system').length,
        compactedMessages: 0,
        blocks: [],
        effectiveContextConfig: contextConfig,
      });
    }

    const recentHistory = selectRecentHistory(
      params.messages,
      contextConfig,
      params.modelCapability
    );
    blocks.push(recentHistory.block);

    const identityContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          block: buildDroppedBlock('identity', 'disabled for benchmark clean mode'),
        }
      : buildIdentityContext(
          getAssistantProfileContextMessage(),
          deps.workspaceSystemMessage?.(params.threadId),
          contextConfig,
          params.modelCapability
        );
    blocks.push(identityContext.block);

    const useLegacyContinuityContextBlocks = shouldUseLegacyContinuityContextBlocks();

    const presenceStateContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          block: buildDroppedBlock('presence-state', 'disabled for benchmark clean mode'),
        }
      : !useLegacyContinuityContextBlocks
        ? {
            systemMessage: '',
            block: buildDroppedBlock(
              'presence-state',
              'disabled by continuity config: runtime presence is no longer part of default prompt context'
            ),
          }
        : buildPresenceStateContext(contextConfig, params.modelCapability);
    blocks.push(presenceStateContext.block);

    const runtimeReflectionContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          block: buildDroppedBlock('runtime-reflection', 'disabled for benchmark clean mode'),
        }
      : !useLegacyContinuityContextBlocks
        ? {
            systemMessage: '',
            block: buildDroppedBlock(
              'runtime-reflection',
              'disabled by continuity config: runtime reflections are no longer part of default prompt context'
            ),
          }
        : buildRuntimeReflectionContext(contextConfig, params.modelCapability);
    blocks.push(runtimeReflectionContext.block);

    const threadSummary =
      benchmarkCleanContext || !params.threadId
        ? null
        : await ensureThreadSummary(params.threadId, contextConfig);
    const summaryContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          block: buildDroppedBlock('thread-summary', 'disabled for benchmark clean mode'),
        }
      : buildThreadSummaryContext(
          threadSummary,
          recentHistory.compactedMessages,
          contextConfig,
          params.modelCapability
        );
    blocks.push(summaryContext.block);

    const lastMessage = params.messages[params.messages.length - 1];
    const query = getPromptFromMessage(lastMessage);
    const memoryContext =
      benchmarkCleanContext
        ? buildDroppedMemoryContext('disabled for benchmark clean mode')
        : params.includeMemory === false
        ? buildDroppedMemoryContext('disabled for chat response path')
        : await buildMemoryContext({
            threadId: params.threadId,
            query,
            memory: deps.memory,
            contextConfig,
            modelCapability: params.modelCapability,
            onMemoryRetrieved: params.onMemoryRetrieved,
          });
    blocks.push(memoryContext.block);

    const baseMessages = insertSystemMessages(
      [...recentHistory.systemMessages, ...recentHistory.recentMessages],
      [
        identityContext.systemMessage,
        presenceStateContext.systemMessage,
        runtimeReflectionContext.systemMessage,
        summaryContext.systemMessage,
        memoryContext.systemMessage,
      ]
    );

    const affectContext = resolveAffectMessage(params, deps.memory);
    blocks.push(
      buildAffectBlock(
        affectContext.message,
        params.modelCapability,
        affectContext.droppedReason
      )
    );

    const baseWithAffect = insertSystemMessages(baseMessages, [affectContext.message]);
    const skillContext: SkillContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          usedSkills: [] as SkillContext['usedSkills'],
          skillMode: params.skillMode === 'auto' ? 'auto' : 'manual',
          block: buildDroppedBlock('skills', 'disabled for benchmark clean mode'),
        }
      : await buildSkillContext({
          inputMessages: baseWithAffect,
          threadId: params.threadId,
          skillIds: params.skillIds,
          skillMode: params.skillMode,
          affectState: params.affectState,
          contextConfig,
          modelCapability: params.modelCapability,
        });
    blocks.push(skillContext.block);

    return buildAssembleResult({
      messages: insertSystemMessages(baseWithAffect, [skillContext.systemMessage]),
      usedSkills: skillContext.usedSkills,
      skillMode: skillContext.skillMode,
      retainedRecentMessages: recentHistory.recentMessages.length,
      compactedMessages: recentHistory.compactedMessages,
      blocks,
      effectiveContextConfig: contextConfig,
    });
  };

  return { assemble };
};

export type ChatContextAssembler = ReturnType<typeof createChatContextAssembler>;
