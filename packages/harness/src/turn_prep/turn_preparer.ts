import * as llmFactory from '@iki/llm-pi-ai/factory';
import { defaultToolRegistry, getPrimaryShellToolName } from '@iki/harness/tools';
import { buildThreadWorkspaceSystemMessage } from '@iki/harness/workspaces/thread_workspace';
import type { ChatExperimentalContext } from '@iki/llm/message/chat_context_mode';
import type { AgentRunKind } from '@iki/core/types/agent_run';
import type { AppConfig } from '@iki/core/types/config';
import type { SkillSummary } from '@iki/core/types/skill';
import { ensureModelCapability } from '@iki/core/utils/provider_models';
import { createChatContextAssembler, type ContextReport } from './context';
import type {
  ChatInputMessage,
  ChatTransportMessage,
} from '@iki/llm/message/chat_message_types';
import { persistThreadRuntimeHints } from './thread_hints';
import { resolveToolNames } from './tool_guard';
import { getPromptFromMessage, toModelInputMessages } from '@iki/llm/message/ui_messages';

export type ChatTurnOptions = {
  providerType: string;
  providerId?: string;
  model: string;

  reasoningEffort?: string;

  personality?: string;

  extraSystemPrompt?: string;

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
  compactionSummary?: string;
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

type ChatTurnRuntimeConfig = {
  autoApproveToolRequests: boolean;
  contextBudget: AppConfig['context'] | null;
  mcpExposureMode?: 'code' | 'direct';
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
  resolveMcpReminders?: (params: {
    threadId?: string;
    mcpServerIds?: string[];
    currentUserAnchor?: string;
  }) => import('@iki/core/types/chat').ThreadSkillReminderAnchor[];
}) => {
  const contextAssembler = createChatContextAssembler({
    workspaceSystemMessage: buildThreadWorkspaceSystemMessage,
    resolveSkillsSystemPrompt: deps.resolveSkillsSystemPrompt,
    ...(deps.resolveMcpReminders ? { resolveMcpReminders: deps.resolveMcpReminders } : {}),
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
    const runtimeConfig = deps.getRuntimeConfig();
    const autoApproveToolRequests = runtimeConfig.autoApproveToolRequests;
    const mcpExposureMode = runtimeConfig.mcpExposureMode ?? 'code';

    const userMessageIds = options.messages
      .filter(
        (m): m is ChatTransportMessage & { role: 'user' } =>
          Boolean(m) && typeof m === 'object' && 'role' in m && m.role === 'user'
      )
      .map(m => ('id' in m && typeof m.id === 'string' && m.id.trim() ? m.id.trim() : undefined));

    const assembledContext = await contextAssembler.assemble({
      messages: modelMessages,
      userMessageIds,
      threadId: options.threadId,
      workspaceSelection: options.workspaceSelection,
      mcpCodeMode: mcpExposureMode === 'code',
      ...(options.mcpServerIds ? { mcpServerIds: options.mcpServerIds } : {}),
      skillIds: options.skillIds,
      skillMode: options.skillMode,
      contextMode: options.experimentalContext?.contextMode,
      ...(options.compactionSummary ? { compactionSummary: options.compactionSummary } : {}),
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

    const { resolvedTools } = await resolveToolNames({
      tools: options.tools,
      ...(mcpExposureMode === 'direct' ? { mcpServerIds: options.mcpServerIds } : {}),
      inputMessages: finalMessages,
      autoApproveToolRequests,
    });

    const explicitToolSelection = Array.isArray(options.tools);
    const skillRequiredTools = explicitToolSelection
      ? []
      : collectRequiredBuiltinSkillTools(usedSkills);
    const mergedResolvedTools = mergeToolNames(resolvedTools, skillRequiredTools);
    const guardedTools = [...mergedResolvedTools];

    const primaryShell = getPrimaryShellToolName();
    if (!explicitToolSelection) {
      if (!guardedTools.includes(primaryShell)) guardedTools.push(primaryShell);
      if (!guardedTools.includes('job')) guardedTools.push('job');
      if (defaultToolRegistry.get('ptc') && !guardedTools.includes('ptc')) {
        guardedTools.push('ptc');
      }
      if (
        mcpExposureMode === 'direct' &&
        Array.isArray(options.mcpServerIds) &&
        options.mcpServerIds.length > 0
      ) {
        const allowedServers = new Set(options.mcpServerIds.map(id => id.trim()).filter(Boolean));
        const mcpTools = defaultToolRegistry
          .getToolMetadata()
          .filter(
            tool =>
              tool.source?.kind === 'mcp' &&
              tool.autoAllowed === true &&
              typeof tool.source.id === 'string' &&
              allowedServers.has(tool.source.id)
          )
          .map(tool => tool.name)
          .sort();
        for (const name of mcpTools) {
          if (!guardedTools.includes(name)) guardedTools.push(name);
        }
      }
    }

    const firstUserMessage = modelMessages.find(message => message.role === 'user');
    const firstUserPrompt = firstUserMessage ? getPromptFromMessage(firstUserMessage) : '';

    persistThreadRuntimeHints({
      threadId: options.threadId ?? '',
      providerType: options.providerType,
      providerId: options.providerId,
      model: options.model,
      ...(firstUserPrompt ? { firstUserPrompt } : {}),
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
