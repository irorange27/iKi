import * as llmFactory from '../provider/llm/factory';
import { defaultToolRegistry } from '@iki/backend/tools';
import { buildThreadWorkspaceSystemMessage } from '@iki/backend/workspaces/thread_workspace';
import type { ChatExperimentalContext } from '@iki/backend/message/chat_context_mode';
import type { AgentRunKind } from '@iki/backend/types/agent_run';
import type { AppConfig } from '@iki/backend/types/config';
import type { SkillSummary } from '@iki/backend/types/skill';
import { ensureModelCapability } from '@iki/backend/utils/provider_models';
import { createChatContextAssembler, type ContextReport } from './context';
import type {
  ChatInputMessage,
  ChatTransportMessage,
} from '@iki/backend/message/chat_message_types';
import { persistThreadRuntimeHints } from './thread_hints';
import { resolveToolNames } from './tool_guard';
import { getPromptFromMessage, toModelInputMessages } from '@iki/backend/message/ui_messages';
import { TODO_PLANNING_TOOL_NAME } from '@iki/backend/tools/task_plan_tools';

export type ChatTurnOptions = {
  providerType: string;
  providerId?: string;
  model: string;

  reasoningEffort?: string;

  personality?: string;

  approvalPolicy?: string;

  requireApproval?: boolean;
  modelCapability?: {
    contextWindow?: number | null;
    maxInputTokens?: number | null;
    maxOutputTokens?: number | null;
  };
  messages: ChatTransportMessage[];

  workspaceSelection?: import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null;
  tools?: string[];
  mcpServerIds?: string[];
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  threadId?: string;
  maxIterations?: number;
  experimentalContext?: ChatExperimentalContext;
  runConfig?: {
    kind?: AgentRunKind;
    parentRunId?: string;
    rootRunId?: string;
    metadata?: Record<string, unknown>;

    adoptRunId?: string;
  };
  autonomous?: {
    maxIterations: number;
    continuePrompt?: string;
  };
};

export type PreparedChatTurn = {
  report: ContextReport;
  usedSkills: SkillSummary[];
  selectedSkillIds: string[];
  skillMode: 'manual' | 'auto';
  maxInputTokens?: number;
  maxOutputTokens?: number;
  finalMessages: ChatInputMessage[];
  history: ChatInputMessage[];
  prompt: string;

  requireApproval: boolean;
  autoApproveToolRequests: boolean;
  guardedTools: string[];
  enableTools: boolean;
};

export type ChatTurnRuntimeConfig = {
  autoApproveToolRequests: boolean;
  contextBudget: AppConfig['context'] | null;
};

const mergeToolNames = (primary: string[], secondary: string[]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const toolName of [...primary, ...secondary]) {
    if (typeof toolName !== 'string') continue;
    const trimmed = toolName.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }

  return merged;
};

const collectRequiredBuiltinSkillTools = (skills: SkillSummary[]): string[] => {
  const requiredTools: string[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    for (const toolName of skill.requiredTools ?? []) {
      if (typeof toolName !== 'string') continue;
      const trimmed = toolName.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      const tool = defaultToolRegistry.get(trimmed);
      if (!tool || tool.source?.kind === 'mcp') continue;
      seen.add(trimmed);
      requiredTools.push(trimmed);
    }
  }

  return requiredTools;
};

export const createChatTurnPreparer = (deps: {
  getRuntimeConfig: () => ChatTurnRuntimeConfig;
  resolveSkillsSystemPrompt: typeof import('../thread_session/skills').resolveSkillsSystemPrompt;
}) => {
  const contextAssembler = createChatContextAssembler({
    workspaceSystemMessage: buildThreadWorkspaceSystemMessage,
    resolveSkillsSystemPrompt: deps.resolveSkillsSystemPrompt,
  });

  const prepareChatTurn = async (options: ChatTurnOptions): Promise<PreparedChatTurn> => {
    const modelMessages = await toModelInputMessages(options.messages);
    const resolvedModelCapability = await llmFactory.resolveModelCapability(
      options.providerType,
      options.model,
      options.providerId
    );
    const modelCapability = ensureModelCapability(
      options.providerType,
      options.model,
      resolvedModelCapability,
      options.modelCapability
    );
    const maxInputTokens = modelCapability.maxInputTokens;
    const maxOutputTokens = modelCapability.maxOutputTokens ?? undefined;
    const lastModelMessage = modelMessages[modelMessages.length - 1];
    const runtimeConfig = deps.getRuntimeConfig();
    const autoApproveToolRequests = runtimeConfig.autoApproveToolRequests;

    const assembledContext = await contextAssembler.assemble({
      messages: modelMessages,
      threadId: options.threadId,
      workspaceSelection: options.workspaceSelection,
      skillIds: options.skillIds,
      skillMode: options.skillMode,
      contextMode: options.experimentalContext?.contextMode,
      modelCapability,
      contextBudgetOverride: runtimeConfig.contextBudget,
    });
    const finalMessages = assembledContext.messages;
    const usedSkills = Array.isArray(assembledContext.usedSkills)
      ? assembledContext.usedSkills
      : [];
    const selectedSkillIds = usedSkills
      .map(skill => skill.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const { resolvedTools, mode } = await resolveToolNames({
      tools: options.tools,
      mcpServerIds: options.mcpServerIds,
      inputMessages: finalMessages,
      autoApproveToolRequests,
    });

    const explicitToolSelection = Array.isArray(options.tools);
    const skillRequiredTools = explicitToolSelection
      ? []
      : collectRequiredBuiltinSkillTools(usedSkills);
    const mergedResolvedTools = mergeToolNames(resolvedTools, skillRequiredTools);
    const guardedTools = mergedResolvedTools.filter(
      toolName => Boolean(options.threadId) || toolName !== TODO_PLANNING_TOOL_NAME
    );

    if (!explicitToolSelection && !guardedTools.includes('shell')) {
      guardedTools.push('shell');
    }

    persistThreadRuntimeHints({
      threadId: options.threadId ?? '',
      providerType: options.providerType,
      providerId: options.providerId,
      model: options.model,
    });

    if (finalMessages.length === 0) {
      throw new Error('No messages provided for chat turn');
    }

    const lastMessage = finalMessages[finalMessages.length - 1];
    const continuationTail = lastMessage.role === 'tool';
    const history = continuationTail ? finalMessages : finalMessages.slice(0, -1);
    const prompt = continuationTail ? '' : getPromptFromMessage(lastMessage);

    return {
      report: assembledContext.report,
      usedSkills,
      selectedSkillIds,
      skillMode: assembledContext.skillMode,
      ...(typeof maxInputTokens === 'number' ? { maxInputTokens } : {}),
      ...(typeof maxOutputTokens === 'number'
        ? { maxOutputTokens }
        : typeof assembledContext.effectiveContextConfig?.maxOutputTokens === 'number'
          ? { maxOutputTokens: assembledContext.effectiveContextConfig.maxOutputTokens }
          : {}),
      finalMessages,
      history,
      prompt,
      requireApproval: options.requireApproval === true,
      autoApproveToolRequests,
      guardedTools,
      enableTools: guardedTools.length > 0 || selectedSkillIds.length > 0,
    };
  };

  return { prepareChatTurn };
};

export type ChatTurnPreparer = ReturnType<typeof createChatTurnPreparer>;
