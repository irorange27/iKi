import { type ModelMessage } from 'ai';

import { getAppConfig } from '../../../core/config';
import * as chatMessageDb from '../../../core/db/chat_message';
import * as threadContextDb from '../../../core/db/thread_context';
import * as memoryDb from '../../../core/db/memory';
import { extractTextFromModelMessageContent } from '../../../core/agent/model_messages';
import {
  generateThreadSummary,
  type ThreadSummaryMessage,
} from '../../../core/context/thread_summary';
import { DEFAULT_APP_CONFIG } from '../../../shared/config/defaults';
import type { ChatInputMessage } from './chat_types';
import type { ChatMemory } from './chat_memory';
import { resolveSkillsSystemPrompt } from './chat_skills';
import { getPromptFromMessage } from './chat_ui';

export type ContextBlockKind = 'recent-history' | 'thread-summary' | 'memory' | 'affect' | 'skills';

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

type SummaryContext = {
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

const estimateTokens = (value: string): number => Math.ceil(value.length / 4);

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const clipTextToTokenBudget = (
  value: string,
  maxTokens: number
): { text: string; truncated: boolean } => {
  if (!value.trim()) return { text: '', truncated: false };
  if (maxTokens <= 0) return { text: '', truncated: value.trim().length > 0 };

  const maxChars = maxTokens * 4;
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true,
  };
};

const getContextConfig = (): ContextConfig => {
  const configured = getAppConfig()?.memory?.context;
  return {
    ...DEFAULT_APP_CONFIG.memory.context,
    ...(configured ?? {}),
  };
};

const countMessageTokens = (message: ChatInputMessage): number => {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content);
  }

  if (message.role === 'tool') {
    return estimateTokens(JSON.stringify(message.content ?? {}));
  }

  return estimateTokens(extractTextFromModelMessageContent(message.content));
};

const clipMessageToBudget = (
  message: ChatInputMessage,
  maxTokens: number
): { message: ChatInputMessage; truncated: boolean } => {
  if (maxTokens <= 0) return { message, truncated: false };

  if (message.role === 'tool') {
    return { message, truncated: false };
  }

  if (typeof message.content === 'string') {
    const clipped = clipTextToTokenBudget(message.content, maxTokens);
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
      maxTokens
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
    const summary = normalizeText(entry.summary);
    return dateText ? `- (${score}, ${dateText}) ${summary}` : `- (${score}) ${summary}`;
  });
  return ['Long-term memory (use only if relevant; ignore if unrelated):', ...lines].join('\n');
};

const selectRecentHistory = (
  messages: ChatInputMessage[],
  contextConfig: ContextConfig
): RecentHistoryContext => {
  const conversationMessages = messages.filter(message => message.role !== 'system');
  const systemMessages = messages.filter(message => message.role === 'system');
  const recentMessages: ChatInputMessage[] = [];
  let recentTokens = 0;
  let truncatedRecentMessages = 0;

  for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
    const isLatestMessage = index === conversationMessages.length - 1;
    const clippedMessage = isLatestMessage
      ? { message: conversationMessages[index], truncated: false }
      : clipMessageToBudget(conversationMessages[index], contextConfig.maxMessageTokens);
    const message = clippedMessage.message;
    const messageTokens = countMessageTokens(message);
    const exceedsBudget =
      recentMessages.length > 0 && recentTokens + messageTokens > contextConfig.maxRecentTokens;
    const exceedsCount = recentMessages.length >= Math.max(1, contextConfig.recentMessageCount);

    if (exceedsBudget || exceedsCount) {
      break;
    }

    recentMessages.unshift(message);
    recentTokens += messageTokens;
    if (clippedMessage.truncated) {
      truncatedRecentMessages += 1;
    }
  }

  const compactedMessages = Math.max(0, conversationMessages.length - recentMessages.length);

  return {
    systemMessages,
    recentMessages,
    compactedMessages,
    block: {
      kind: 'recent-history',
      status: compactedMessages > 0 || truncatedRecentMessages > 0 ? 'truncated' : 'included',
      estimatedTokens: recentTokens,
      charCount: recentMessages.reduce(
        (sum, message) => sum + buildMessagePreview(message).length,
        0
      ),
      ...(compactedMessages > 0 || truncatedRecentMessages > 0
        ? {
            reason:
              compactedMessages > 0 && truncatedRecentMessages > 0
                ? 'compacted older turns and clipped oversized recent text'
                : compactedMessages > 0
                  ? 'compacted older turns into summary/recent window'
                  : 'clipped oversized recent text',
          }
        : {}),
      sourceCount: recentMessages.length,
    },
  };
};

const buildThreadSummaryContext = (
  threadSummary: ThreadSummaryState | null,
  compactedMessages: number,
  contextConfig: ContextConfig
): SummaryContext => {
  const summaryClip = threadSummary?.summary
    ? clipTextToTokenBudget(threadSummary.summary, contextConfig.maxSummaryTokens)
    : { text: '', truncated: false };

  if (threadSummary?.summary) {
    return {
      systemMessage: `Thread summary:\n${summaryClip.text}`,
      block: {
        kind: 'thread-summary',
        status: summaryClip.truncated ? 'truncated' : 'included',
        estimatedTokens: estimateTokens(summaryClip.text),
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

const toMemoryDisplayEntry = (result: Record<string, unknown>) => ({
  summary: typeof result.summary === 'string' ? result.summary : '',
  score: typeof result.score === 'number' ? result.score : Number(result.score || 0),
  updated_at: typeof result.updated_at === 'string' ? result.updated_at : undefined,
});

const buildMemoryContext = (params: {
  threadId?: string;
  query: string;
  memory: ChatMemory;
  contextConfig: ContextConfig;
  onMemoryRetrieved?: AssembleChatContextParams['onMemoryRetrieved'];
}): MemoryContext => {
  if (!params.query.trim()) {
    return {
      systemMessage: '',
      block: {
        kind: 'memory',
        status: 'dropped',
        estimatedTokens: 0,
        charCount: 0,
        reason: 'no user query available',
      },
    };
  }

  if (!params.threadId) {
    return {
      systemMessage: '',
      block: {
        kind: 'memory',
        status: 'dropped',
        estimatedTokens: 0,
        charCount: 0,
        reason: 'no relevant memory retrieved',
      },
    };
  }

  const memoryPayload = params.memory.retrieveRelevantMemory(params.threadId, params.query);
  if (!memoryPayload) {
    return {
      systemMessage: '',
      block: {
        kind: 'memory',
        status: 'dropped',
        estimatedTokens: 0,
        charCount: 0,
        reason: 'no relevant memory retrieved',
      },
    };
  }

  let memoryResults = [...memoryPayload.results];
  let memorySystemMessage = buildMemorySystemMessage(memoryResults.map(toMemoryDisplayEntry));

  while (
    memoryResults.length > 1 &&
    estimateTokens(memorySystemMessage) > params.contextConfig.maxMemoryTokens
  ) {
    memoryResults = memoryResults.slice(0, -1);
    memorySystemMessage = buildMemorySystemMessage(memoryResults.map(toMemoryDisplayEntry));
  }

  const memoryClip = clipTextToTokenBudget(
    memorySystemMessage,
    params.contextConfig.maxMemoryTokens
  );
  params.onMemoryRetrieved?.({
    query: memoryPayload.query,
    results: memoryResults,
    systemMessage: memoryClip.text,
  });

  return {
    systemMessage: memoryClip.text,
    block: {
      kind: 'memory',
      status: memoryClip.text
        ? memoryClip.truncated || memoryResults.length < memoryPayload.results.length
          ? 'truncated'
          : 'included'
        : 'dropped',
      estimatedTokens: estimateTokens(memoryClip.text),
      charCount: memoryClip.text.length,
      ...(memoryClip.text
        ? memoryClip.truncated
          ? { reason: 'memory block clipped to context budget' }
          : memoryResults.length < memoryPayload.results.length
            ? { reason: 'memory items reduced to fit context budget' }
            : {}
        : { reason: 'no relevant memory retrieved' }),
      sourceCount: memoryResults.length,
    },
  };
};

const resolveAffectMessage = (
  params: Pick<AssembleChatContextParams, 'realtimeAffectMessage' | 'threadId'>,
  memory: ChatMemory
): string => {
  if (params.realtimeAffectMessage?.trim()) {
    return params.realtimeAffectMessage.trim();
  }

  return params.threadId ? memory.getAffectContextMessage(params.threadId) : '';
};

const buildAffectBlock = (affectMessage: string): ContextReportBlock => ({
  kind: 'affect',
  status: affectMessage ? 'included' : 'dropped',
  estimatedTokens: estimateTokens(affectMessage),
  charCount: affectMessage.length,
  ...(affectMessage ? {} : { reason: 'no affect context available' }),
});

const buildSkillContext = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  contextConfig: ContextConfig;
}): Promise<SkillContext> => {
  const { skillsSystemPrompt, usedSkills, skillMode } = await resolveSkillsSystemPrompt({
    inputMessages: params.inputMessages,
    threadId: params.threadId,
    skillIds: params.skillIds,
    skillMode: params.skillMode,
  });
  const skillClip = clipTextToTokenBudget(skillsSystemPrompt, params.contextConfig.maxSkillTokens);

  return {
    systemMessage: skillClip.text,
    usedSkills,
    skillMode,
    block: {
      kind: 'skills',
      status: skillClip.text ? (skillClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTokens(skillClip.text),
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
}): AssembleChatContextResult => ({
  messages: params.messages,
  usedSkills: params.usedSkills,
  skillMode: params.skillMode,
  report: {
    totalEstimatedTokens: params.blocks.reduce((sum, block) => sum + block.estimatedTokens, 0),
    retainedRecentMessages: params.retainedRecentMessages,
    compactedMessages: params.compactedMessages,
    blocks: params.blocks,
  },
});

export const createChatContextAssembler = (deps: { memory: ChatMemory }) => {
  const assemble = async (
    params: AssembleChatContextParams
  ): Promise<AssembleChatContextResult> => {
    const contextConfig = getContextConfig();
    const blocks: ContextReportBlock[] = [];

    if (!contextConfig.enabled) {
      return buildAssembleResult({
        messages: params.messages,
        usedSkills: [],
        skillMode: params.skillMode === 'auto' ? 'auto' : 'manual',
        retainedRecentMessages: params.messages.filter(message => message.role !== 'system').length,
        compactedMessages: 0,
        blocks: [],
      });
    }

    const recentHistory = selectRecentHistory(params.messages, contextConfig);
    blocks.push(recentHistory.block);

    const threadSummary = params.threadId
      ? await ensureThreadSummary(params.threadId, contextConfig)
      : null;
    const summaryContext = buildThreadSummaryContext(
      threadSummary,
      recentHistory.compactedMessages,
      contextConfig
    );
    blocks.push(summaryContext.block);

    const lastMessage = params.messages[params.messages.length - 1];
    const query = getPromptFromMessage(lastMessage);
    const memoryContext = buildMemoryContext({
      threadId: params.threadId,
      query,
      memory: deps.memory,
      contextConfig,
      onMemoryRetrieved: params.onMemoryRetrieved,
    });
    blocks.push(memoryContext.block);

    const baseMessages = insertSystemMessages(
      [...recentHistory.systemMessages, ...recentHistory.recentMessages],
      [summaryContext.systemMessage, memoryContext.systemMessage]
    );

    const affectMessage = resolveAffectMessage(params, deps.memory);
    blocks.push(buildAffectBlock(affectMessage));

    const baseWithAffect = insertSystemMessages(baseMessages, [affectMessage]);
    const skillContext = await buildSkillContext({
      inputMessages: baseWithAffect,
      threadId: params.threadId,
      skillIds: params.skillIds,
      skillMode: params.skillMode,
      contextConfig,
    });
    blocks.push(skillContext.block);

    return buildAssembleResult({
      messages: insertSystemMessages(baseWithAffect, [skillContext.systemMessage]),
      usedSkills: skillContext.usedSkills,
      skillMode: skillContext.skillMode,
      retainedRecentMessages: recentHistory.recentMessages.length,
      compactedMessages: recentHistory.compactedMessages,
      blocks,
    });
  };

  return { assemble };
};

export type ChatContextAssembler = ReturnType<typeof createChatContextAssembler>;
