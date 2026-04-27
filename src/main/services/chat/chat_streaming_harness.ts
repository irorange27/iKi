import {
  createConversationHarness,
  type AgentTool,
  type ConversationHarness,
} from '../../../core/agent';
import { getAppConfig } from '../../../core/config';
import { createLogger } from '../../../core/logger';
import { defaultToolRegistry } from '../../../core/tools';
import { LoadSkillTool } from '../../../core/tools/skill_tools';
import { applyToolApprovalPolicy } from '../../../shared/utils/tool_approval';
import { createChatConversationRunner } from './chat_conversation_runner';
import type { ApprovalRecoveryContext } from './chat_approval_types';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

const getEmotionConfig = () => getAppConfig()?.memory?.emotion || null;
const shouldAutoApproveToolRequests = () =>
  getAppConfig()?.general?.autoApproveToolRequests === true;

const registerToolWithGuard = (
  harness: ConversationHarness,
  toolName: string,
  guardActive: boolean
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;

  const emotionConfig = getEmotionConfig();
  const requireApproval = guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);
  const registered = applyToolApprovalPolicy(
    requireApproval ? { ...tool, needsApproval: true } : tool,
    {
      autoApproveToolRequests: shouldAutoApproveToolRequests(),
    }
  );
  harness.registerTool(registered);
  return registered;
};

export const createChatHarness = (params: {
  threadId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  enabledTools: string[];
  availableSkillIds: string[];
  guardActive: boolean;
  maxIterations: number;
  maxOutputTokens?: number;
}): ConversationHarness => {
  const runner = createChatConversationRunner({
    providerType: params.providerType,
    providerId: params.providerId,
    model: params.model,
    systemPrompt: params.systemPrompt,
    enableTools: params.enableTools,
    enabledTools: params.enabledTools,
    maxIterations: params.maxIterations,
    ...(typeof params.maxOutputTokens === 'number'
      ? { maxTokens: params.maxOutputTokens }
      : {}),
  });

  const harness = createConversationHarness({
    runner,
    toolRuntimeContext: {
      threadId: params.threadId,
      availableSkillIds: params.availableSkillIds,
      conversationModel: {
        providerType: params.providerType,
        ...(typeof params.providerId === 'string' && params.providerId.trim()
          ? { providerId: params.providerId.trim() }
          : {}),
        model: params.model,
        ...(typeof params.maxOutputTokens === 'number'
          ? { maxTokens: params.maxOutputTokens }
          : {}),
      },
      delegationDepth: 0,
    },
  });

  if (!params.enableTools) {
    return harness;
  }

  if (params.availableSkillIds.length > 0) {
    harness.registerTool(new LoadSkillTool().toAgentTool());
  }

  for (const toolName of params.enabledTools) {
    if (!defaultToolRegistry.get(toolName)) {
      chatStreamingLogger.warn(`Tool ${toolName} not found in registry`);
      continue;
    }
    registerToolWithGuard(harness, toolName, params.guardActive);
  }

  return harness;
};

export const createApprovalRecoveryContext = (params: {
  threadId?: string;
  sessionId: string;
  runId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxIterations: number;
  enabledTools: string[];
  availableSkillIds: string[];
  autonomous?: {
    maxIterations: number;
    continuePrompt?: string;
  };
}): ApprovalRecoveryContext | undefined => {
  const threadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  const sessionId = params.sessionId.trim();
  if (!threadId || !sessionId) return undefined;

  return {
    sessionId,
    threadId,
    assistantMessageId: sessionId,
    ...(typeof params.runId === 'string' && params.runId.trim()
      ? { runId: params.runId.trim() }
      : {}),
    providerType: params.providerType,
    ...(typeof params.providerId === 'string' && params.providerId.trim()
      ? { providerId: params.providerId.trim() }
      : {}),
    model: params.model,
    systemPrompt: params.systemPrompt,
    ...(typeof params.maxInputTokens === 'number'
      ? { maxInputTokens: params.maxInputTokens }
      : {}),
    ...(typeof params.maxOutputTokens === 'number'
      ? { maxOutputTokens: params.maxOutputTokens }
      : {}),
    maxIterations: params.maxIterations,
    enabledTools: [...params.enabledTools],
    availableSkillIds: [...params.availableSkillIds],
    ...(params.autonomous ? { autonomous: { ...params.autonomous } } : {}),
  };
};

export const describeApprovalRequiredTools = (
  requests: Array<{ toolCall?: { toolName: string } }>
): string => {
  const toolNames = requests
    .map(request => request.toolCall?.toolName)
    .filter(
      (toolName): toolName is string => typeof toolName === 'string' && toolName.trim().length > 0
    )
    .filter((toolName, index, list) => list.indexOf(toolName) === index);

  if (toolNames.length === 0) {
    return 'Tool approval required for non-interactive chat';
  }

  return `Tool approval required for non-interactive chat: ${toolNames.join(', ')}`;
};
