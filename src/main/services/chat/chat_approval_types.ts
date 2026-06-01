import type { ModelMessage } from 'ai';
import type { AgentResult, ToolApprovalRequest } from '../../../core/agent';
import type { ChatWebContents } from './chat_types';

export type ApprovalRecoveryContext = {
  sessionId: string;
  threadId: string;
  assistantMessageId: string;
  runId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxIterations?: number;
  enabledTools: string[];
  availableSkillIds?: string[];
  autonomous?: {
    maxIterations: number;
    continuePrompt?: string;
  };
};

export type RegisterApprovalBatch = (
  approvalRequests: ToolApprovalRequest[],
  session: {
    webContents: ChatWebContents;
    history?: ModelMessage[];
    recoveryContext?: ApprovalRecoveryContext;
  }
) => void;

export type ToolLoopStreamResult = {
  awaitingApproval: boolean;
  cancelled?: boolean;
  finished?: boolean;
  partialFailure?: boolean;
  response?: string;
  usage?: AgentResult['usage'];
  handoff?: {
    summary: string;
    nextSteps: string;
    reason: string;
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
