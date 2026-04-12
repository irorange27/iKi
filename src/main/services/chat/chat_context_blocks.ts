import type { AffectState } from '../../../core/emotion/affect_state';
import { normalizeWhitespace } from '../../../shared/utils/text';
import type { ModelCapability } from '../../../shared/utils/provider_models';
import { resolveSkillsSystemPrompt } from './chat_skills';
import { getPromptFromMessage } from './chat_ui';
import {
  getAssistantProfileContextMessage,
  retrieveRelevantContinuity,
} from '../continuity/continuity_service';
import type { ChatMemory } from './chat_memory';
import type {
  AssembleChatContextParams,
  ContextConfig,
  ContextReportBlock,
  IdentityContext,
  MemoryContext,
  SkillContext,
} from './chat_context_types';
import {
  buildDroppedBlock,
  clipTextToTokenBudget,
  estimateTextTokens,
} from './chat_context_helpers';
import type { ChatInputMessage } from './chat_types';

export const buildIdentityContext = (
  workspaceSystemMessage: ((threadId?: string) => string) | undefined,
  threadId: string | undefined,
  contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): IdentityContext => {
  const combinedMessage = [
    getAssistantProfileContextMessage().trim(),
    workspaceSystemMessage?.(threadId)?.trim() ?? '',
  ]
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

const toMemoryDisplayEntry = (result: Record<string, unknown>) => ({
  summary: typeof result.summary === 'string' ? result.summary : '',
  score: typeof result.score === 'number' ? result.score : Number(result.score || 0),
  updated_at: typeof result.updated_at === 'string' ? result.updated_at : undefined,
});

export const buildDroppedMemoryContext = (reason: string): MemoryContext => ({
  systemMessage: '',
  block: {
    kind: 'memory',
    status: 'dropped',
    estimatedTokens: 0,
    charCount: 0,
    reason,
  },
});

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

export const buildMemoryContext = async (params: {
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

export const resolveAffectMessage = (
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

export const buildAffectBlock = (
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

export const buildSkillContext = async (params: {
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

export const buildQueryFromMessages = (messages: ChatInputMessage[]): string => {
  const lastMessage = messages[messages.length - 1];
  return getPromptFromMessage(lastMessage);
};

export { buildDroppedBlock };
