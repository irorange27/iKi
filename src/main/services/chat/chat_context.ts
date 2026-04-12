import { deriveModelAwareContextConfig } from './chat_context_budget';
import type { ChatMemory } from './chat_memory';
import {
  buildAffectBlock,
  buildDroppedBlock,
  buildDroppedMemoryContext,
  buildIdentityContext,
  buildMemoryContext,
  buildQueryFromMessages,
  buildSkillContext,
  resolveAffectMessage,
} from './chat_context_blocks';
import {
  buildAssembleResult,
  getContextConfig,
  insertSystemMessages,
} from './chat_context_helpers';
import {
  buildThreadSummaryContext,
  ensureThreadSummary,
  selectRecentHistory,
} from './chat_context_history';
import type { AssembleChatContextParams, SkillContext } from './chat_context_types';

export type {
  ContextBlockKind,
  ContextBlockStatus,
  ContextReportBlock,
  ContextReport,
} from './chat_context_types';

export const createChatContextAssembler = (deps: {
  memory: ChatMemory;
  workspaceSystemMessage?: (threadId?: string) => string;
}) => {
  const assemble = async (params: AssembleChatContextParams) => {
    const contextConfig = deriveModelAwareContextConfig(getContextConfig(), params.modelCapability);
    const blocks = [] as Array<ReturnType<typeof buildDroppedBlock>>;
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
          deps.workspaceSystemMessage,
          params.threadId,
          contextConfig,
          params.modelCapability
        );
    blocks.push(identityContext.block);

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

    const query = buildQueryFromMessages(params.messages);
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
          usedSkills: [],
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
