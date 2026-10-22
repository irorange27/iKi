import { deriveModelAwareContextConfig } from './context_budget';
import {
  buildDroppedBlock,
  buildIdentityContext,
  buildSkillContext,
  readAgentInstructions,
  readAgentInstructionsForSelection,
} from './context_blocks';
import { buildWorkspaceSystemMessageForSelection } from '../workspaces/thread_workspace';
import { buildAssembleResult, getContextConfig, insertSystemMessages } from './context_helpers';
import { selectRecentHistory } from './context_history';
import type { AssembleChatContextParams, SkillContext } from './context_types';

export type {
  ContextBlockKind,
  ContextBlockStatus,
  ContextReportBlock,
  ContextReport,
} from './context_types';

export const createChatContextAssembler = (deps: {
  workspaceSystemMessage?: (threadId?: string) => string;
  resolveSkillsSystemPrompt: typeof import('../thread_session/skills').resolveSkillsSystemPrompt;
}) => {
  const assemble = async (params: AssembleChatContextParams) => {
    const contextConfig = deriveModelAwareContextConfig(
      getContextConfig(params.contextBudgetOverride),
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

    const recentHistory = selectRecentHistory(params.messages, params.modelCapability);
    blocks.push(recentHistory.block);

    const workspaceSystemMessage =
      params.workspaceSelection !== undefined
        ? buildWorkspaceSystemMessageForSelection(params.workspaceSelection)
        : (deps.workspaceSystemMessage?.(params.threadId) ?? '');
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
          agentInstructions,
        );
    blocks.push(identityContext.block);

    blocks.push(buildDroppedBlock('thread-summary', 'managed at model step boundary'));

    const withIdentity = insertSystemMessages(
      [...recentHistory.systemMessages, ...recentHistory.recentMessages],
      [identityContext.systemMessage]
    );

    const skillContext: SkillContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          usedSkills: [],
          skillMode: params.skillMode === 'auto' ? 'auto' : 'manual',
          block: buildDroppedBlock('skills', 'disabled for benchmark clean mode'),
        }
      : await buildSkillContext({
          inputMessages: withIdentity,
          threadId: params.threadId,
          skillIds: params.skillIds,
          skillMode: params.skillMode,
          contextConfig,
          resolveSkillsSystemPrompt: deps.resolveSkillsSystemPrompt,
        });
    blocks.push(skillContext.block);

    return buildAssembleResult({
      messages: insertSystemMessages(withIdentity, [skillContext.systemMessage]),
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
