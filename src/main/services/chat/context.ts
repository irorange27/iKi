import { deriveModelAwareContextConfig } from './context_budget';
import type { ChatMemory } from './memory';
import {
  buildAffectBlock,
  buildClipboardContext,
  buildDroppedBlock,
  buildDroppedMemoryContext,
  buildIdentityContext,
  buildMemoryContext,
  buildQueryFromMessages,
  buildSkillContext,
  readAgentInstructions,
  resolveAffectMessage,
} from './context_blocks';
import {
  buildAssembleResult,
  getContextConfig,
  insertSystemMessages,
} from './context_helpers';
import {
  buildThreadSummaryContext,
  ensureThreadSummary,
  selectRecentHistory,
} from './context_history';
import type { AssembleChatContextParams, SkillContext } from './context_types';

export type {
  ContextBlockKind,
  ContextBlockStatus,
  ContextReportBlock,
  ContextReport,
} from './context_types';

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
          params.modelCapability,
          readAgentInstructions(params.threadId)
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

    const clipboardContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          block: buildDroppedBlock('clipboard', 'disabled for benchmark clean mode'),
        }
      : buildClipboardContext(contextConfig, params.modelCapability);
    blocks.push(clipboardContext.block);

    const baseWithAffect = insertSystemMessages(baseMessages, [
      affectContext.message,
      clipboardContext.systemMessage,
    ]);
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
