import { deriveModelAwareContextConfig } from './context_budget';
import type { ChatMemory } from '../thread_session/memory';
import {
  buildAffectBlock,
  buildDroppedBlock,
  buildDroppedMemoryContext,
  buildIdentityContext,
  buildMemoryContext,
  buildQueryFromMessages,
  buildSkillContext,
  readAgentInstructions,
  readAgentInstructionsForSelection,
  resolveAffectMessage,
} from './context_blocks';
import { buildWorkspaceSystemMessageForSelection } from '../workspaces/thread_workspace';
import {
  appendContextToLastUserMessage,
  buildAssembleResult,
  getContextConfig,
  insertSystemMessages,
} from './context_helpers';
import {
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
  resolveSkillsSystemPrompt: typeof import('../thread_session/skills').resolveSkillsSystemPrompt;
  getAssistantProfileContextMessage: () => string;
  retrieveRelevantContinuity: (query: string) => import('@iki/backend/chat_platform').ContinuityRetrievalPayload | null;
}) => {
  const assemble = async (params: AssembleChatContextParams) => {
    const contextConfig = deriveModelAwareContextConfig(
      getContextConfig(params.memoryContextConfig),
      params.modelCapability
    );
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

    // The identity block must render the SAME world the turn executes in:
    // when the caller holds a turn-start snapshot it wins (an explicit null
    // means the turn started with no workspace); without one, resolve fresh.
    const workspaceSystemMessage =
      params.workspaceSelection !== undefined
        ? buildWorkspaceSystemMessageForSelection(params.workspaceSelection)
        : deps.workspaceSystemMessage?.(params.threadId) ?? '';
    const agentInstructions =
      params.workspaceSelection !== undefined
        ? readAgentInstructionsForSelection(params.workspaceSelection)
        : readAgentInstructions(params.threadId);
    const identityContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          block: buildDroppedBlock('identity', 'disabled for benchmark clean mode'),
        }
      : buildIdentityContext(
          () => workspaceSystemMessage,
          params.threadId,
          contextConfig,
          params.modelCapability,
          agentInstructions,
          deps.getAssistantProfileContextMessage
        );
    blocks.push(identityContext.block);

    blocks.push(buildDroppedBlock('thread-summary', 'managed at model step boundary'));

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
              retrieveContinuity: deps.retrieveRelevantContinuity,
            });
    blocks.push(memoryContext.block);

    const baseMessages = insertSystemMessages(
      [...recentHistory.systemMessages, ...recentHistory.recentMessages],
      [identityContext.systemMessage]
    );

    const affectContext = resolveAffectMessage(params, deps.memory);
    blocks.push(
      buildAffectBlock(
        affectContext.message,
        params.modelCapability,
        affectContext.droppedReason
      )
    );

    // Identity and skills are stable instruction blocks and stay in the system
    // prefix. Memory and affect are per-turn data: they ride with the newest
    // user message so a change to them cannot invalidate the cached history
    // prefix.
    const baseWithVolatile = appendContextToLastUserMessage(
      baseMessages,
      [memoryContext.systemMessage, affectContext.message]
        .filter(part => part.trim().length > 0)
        .join('\n\n')
    );
    const skillContext: SkillContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          usedSkills: [],
          skillMode: params.skillMode === 'auto' ? 'auto' : 'manual',
          block: buildDroppedBlock('skills', 'disabled for benchmark clean mode'),
        }
      : await buildSkillContext({
          inputMessages: baseWithVolatile,
          threadId: params.threadId,
          skillIds: params.skillIds,
          skillMode: params.skillMode,
          affectState: params.affectState,
          contextConfig,
          modelCapability: params.modelCapability,
          resolveSkillsSystemPrompt: deps.resolveSkillsSystemPrompt,
        });
    blocks.push(skillContext.block);

    return buildAssembleResult({
      messages: insertSystemMessages(baseWithVolatile, [skillContext.systemMessage]),
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
