import { deriveModelAwareContextConfig } from './context_budget';
import { estimateTextTokens } from '../agent/context_budget';
import {
  buildDroppedBlock,
  buildIdentityContext,
  buildSkillContext,
  readAgentInstructions,
  readAgentInstructionsForSelection,
} from './context_blocks';
import {
  buildWorkspaceSystemMessageForSelection,
  getThreadWorkspaceSelection,
} from '../workspaces/thread_workspace';
import { buildAssembleResult, getContextConfig } from './context_helpers';
import { selectRecentHistory } from './context_history';
import type { AssembleChatContextParams, SkillContext } from './context_types';
import { getRuntimeReminderText } from '@iki/system-prompt/persona';
import {
  SYSTEM_PROMPT_SECTION_ORDERS,
  formatPromptContextSnapshot,
  joinPromptSections,
  renderPromptSections,
} from '@iki/system-prompt/assembler';
import type { ModelMessage } from '@iki/llm/message/model_history';

export type {
  ContextBlockKind,
  ContextBlockStatus,
  ContextReportBlock,
  ContextReport,
} from './context_types';

const extractSystemTexts = (messages: readonly ModelMessage[]): string[] =>
  messages
    .map(message => (typeof message.content === 'string' ? message.content.trim() : ''))
    .filter(Boolean);

export const createChatContextAssembler = (deps: {
  workspaceSystemMessage?: (threadId?: string) => string;
  resolveSkillsSystemPrompt: typeof import('../thread_session/skills').resolveSkillsSystemPrompt;
  resolveMcpReminders?: (params: {
    threadId?: string;
    mcpServerIds?: string[];
    currentUserAnchor?: string;
  }) => import('@iki/core/types/chat').ThreadSkillReminderAnchor[];
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

    const recentHistory = selectRecentHistory(params.messages);
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
          runtimeWorkspaceText: '',
          block: buildDroppedBlock('identity', 'disabled for benchmark clean mode'),
        }
      : buildIdentityContext(
          () => workspaceSystemMessage,
          params.threadId,
          contextConfig,
          agentInstructions,
        );
    blocks.push(identityContext.block);

    const compactionSummary = params.compactionSummary?.trim();
    blocks.push(
      compactionSummary
        ? {
            kind: 'thread-summary',
            status: 'included',
            estimatedTokens: estimateTextTokens(compactionSummary),
            charCount: compactionSummary.length,
          }
        : buildDroppedBlock('thread-summary', 'managed at model step boundary')
    );

    const runtimeReminderText = benchmarkCleanContext
      ? ''
      : formatPromptContextSnapshot([
          {
            name: 'runtime',
            order: 10,
            text: getRuntimeReminderText({ workspaceText: identityContext.runtimeWorkspaceText }),
          },
        ]);
    const runtimeReminderMessage: ModelMessage | null = runtimeReminderText
      ? { role: 'user', content: runtimeReminderText }
      : null;

    const projectSystemSection = identityContext.systemMessage
      ? joinPromptSections(
          renderPromptSections([
            {
              name: 'project_context',
              order: SYSTEM_PROMPT_SECTION_ORDERS.project_context,
              text: identityContext.systemMessage,
            },
          ])
        )
      : '';
    const skillInputMessages: ModelMessage[] = [
      ...(projectSystemSection ? [{ role: 'system' as const, content: projectSystemSection }] : []),
      ...(runtimeReminderMessage ? [runtimeReminderMessage] : []),
      ...recentHistory.recentMessages,
    ];

    const userMessagesCount = recentHistory.recentMessages.filter(m => m.role === 'user').length;
    const anchorForUserIndex = (userIndex: number): string => {
      const explicitId = params.userMessageIds?.[userIndex]?.trim();
      return explicitId || `idx:${userIndex}`;
    };
    const currentUserAnchor =
      userMessagesCount > 0 ? anchorForUserIndex(userMessagesCount - 1) : undefined;

    const effectiveWorkspacePath =
      params.workspaceSelection !== undefined
        ? params.workspaceSelection?.workspace?.path
        : getThreadWorkspaceSelection(params.threadId)?.workspace?.path;

    const skillContext: SkillContext = benchmarkCleanContext
      ? {
          systemMessage: '',
          usedSkills: [],
          skillMode: params.skillMode === 'auto' ? 'auto' : 'manual',
          anchoredReminders: [],
          block: buildDroppedBlock('skills', 'disabled for benchmark clean mode'),
        }
      : await buildSkillContext({
          inputMessages: skillInputMessages,
          threadId: params.threadId,
          workspacePath: effectiveWorkspacePath,
          skillIds: params.skillIds,
          skillMode: params.skillMode,
          currentUserAnchor,
          contextConfig,
          resolveSkillsSystemPrompt: deps.resolveSkillsSystemPrompt,
        });
    blocks.push(skillContext.block);

    const staticSections = joinPromptSections(
      renderPromptSections([
        ...(identityContext.systemMessage
          ? [
              {
                name: 'project_context',
                order: SYSTEM_PROMPT_SECTION_ORDERS.project_context,
                text: identityContext.systemMessage,
              },
            ]
          : []),
        ...(skillContext.systemMessage
          ? [
              {
                name: 'skills',
                order: SYSTEM_PROMPT_SECTION_ORDERS.skills,
                text: skillContext.systemMessage,
              },
            ]
          : []),
      ])
    );
    const singleSystemText = [
      ...extractSystemTexts(recentHistory.systemMessages),
      staticSections,
    ]
      .filter(Boolean)
      .join('\n\n');

    const mcpAnchoredReminders =
      benchmarkCleanContext || params.mcpCodeMode === false || !deps.resolveMcpReminders
        ? []
        : deps.resolveMcpReminders({
            threadId: params.threadId,
            mcpServerIds: params.mcpServerIds,
            currentUserAnchor,
          });

    const reminderByAnchor = new Map<string, string[]>();
    for (const item of [...(skillContext.anchoredReminders ?? []), ...mcpAnchoredReminders]) {
      const list = reminderByAnchor.get(item.beforeAnchor) ?? [];
      list.push(item.text);
      reminderByAnchor.set(item.beforeAnchor, list);
    }
    const interleavedRecentMessages: ModelMessage[] = [];
    let seenUserIndex = 0;
    for (const message of recentHistory.recentMessages) {
      if (message.role === 'user') {
        const anchor = anchorForUserIndex(seenUserIndex);
        seenUserIndex += 1;
        const reminderTexts = reminderByAnchor.get(anchor);
        if (reminderTexts) {
          for (const reminderText of reminderTexts) {
            interleavedRecentMessages.push({ role: 'user', content: reminderText });
          }
        }
      }
      interleavedRecentMessages.push(message);
    }

    return buildAssembleResult({
      messages: [
        ...(singleSystemText ? [{ role: 'system' as const, content: singleSystemText }] : []),
        ...(runtimeReminderMessage ? [runtimeReminderMessage] : []),
        ...interleavedRecentMessages,
      ],
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
