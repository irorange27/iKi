import type { ModelMessage, ToolApprovalResponse } from 'ai';

import type { AgentResult, ConversationHarness, ToolApprovalRequest } from '../../../core/agent';
import type { TokenUsagePartData } from '../../../shared/chat/message_parts';
import { createLogger } from '../../../core/logger';
import { getErrorMessage } from '../../utils/errors';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import type { ChatWebContents, ToolStreamEvent, UiChunkEmitter } from './chat_types';

const chatToolLoopLogger = createLogger({ module: 'chat_tool_loop' });

export type RegisterApprovalBatch = (
  approvalRequests: ToolApprovalRequest[],
  session: {
    harness: ConversationHarness;
    webContents: ChatWebContents;
    history?: ModelMessage[];
    recoveryContext?: ApprovalRecoveryContext;
  }
) => void;

export type ToolLoopStreamParams = {
  harness: ConversationHarness;
  webContents: ChatWebContents;
  history?: ModelMessage[];
  prompt: string;
  approvalResponses?: ToolApprovalResponse[];
  shouldCancel?: () => boolean;
  onToolEvent?: (event: ToolStreamEvent) => void;
  abortSignal?: AbortSignal;
  uiChunkEmitter?: UiChunkEmitter;
  approvalContext?: ApprovalRecoveryContext;
  tokenUsageContext?: Pick<
    TokenUsagePartData,
    'maxInputTokens' | 'maxOutputTokens' | 'model' | 'providerType' | 'providerId'
  >;
};

export type ToolLoopStreamResult = {
  awaitingApproval: boolean;
  cancelled?: boolean;
  response?: string;
  usage?: AgentResult['usage'];
};

export type ToolLoopRunner = {
  stream: (params: ToolLoopStreamParams) => Promise<ToolLoopStreamResult>;
};

export const createToolLoopRunner = (deps: {
  registerApprovalBatch: RegisterApprovalBatch;
}): ToolLoopRunner => ({
  stream: params =>
    streamToolLoop({
      ...params,
      registerApprovalBatch: deps.registerApprovalBatch,
    }),
});

const streamToolLoop = async (
  params: ToolLoopStreamParams & { registerApprovalBatch: RegisterApprovalBatch }
) => {
  const generator = params.harness.stream({
    history: params.history,
    prompt: params.prompt,
    approvalResponses: params.approvalResponses,
    onStreamPart: params.onToolEvent,
    abortSignal: params.abortSignal,
  });
  let fullResponse = '';
  let cancelled = false;
  let next: IteratorResult<string, AgentResult> | null = null;

  try {
    next = await generator.next();
    while (!next.done) {
      if (params.shouldCancel?.()) {
        cancelled = true;
        try {
          await generator.return(undefined);
        } catch (error) {
          chatToolLoopLogger.event({
            level: 'warn',
            event: 'chat.tool_stream.close',
            outcome: 'degraded',
            error,
            message: 'Failed to close cancelled tool stream.',
          });
        }
        break;
      }

      const chunk = next.value;
      if (typeof chunk === 'string' && chunk) {
        fullResponse += chunk;
        params.uiChunkEmitter?.emitTextDelta(chunk);
      }
      next = await generator.next();
    }
  } catch (error) {
    if (params.shouldCancel?.() || (error instanceof Error && error.name === 'AbortError')) {
      cancelled = true;
      try {
        await generator.return(undefined);
      } catch (returnError) {
        chatToolLoopLogger.event({
          level: 'warn',
          event: 'chat.tool_stream.close',
          outcome: 'degraded',
          error: returnError,
          message: 'Failed to close aborted tool stream.',
        });
      }
    } else {
      params.uiChunkEmitter?.error(getErrorMessage(error));
      throw error;
    }
  }

  if (cancelled || !next) {
    params.uiChunkEmitter?.abort();
    return { awaitingApproval: false, cancelled: true };
  }

  const agentResult = (next.value ?? null) as AgentResult | null;
  const emitTokenUsage = (usage: AgentResult['usage'] | undefined) => {
    if (!usage) return;
    params.uiChunkEmitter?.emitTokenUsage({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      ...(typeof params.tokenUsageContext?.maxInputTokens === 'number'
        ? { maxInputTokens: params.tokenUsageContext.maxInputTokens }
        : {}),
      ...(typeof params.tokenUsageContext?.maxOutputTokens === 'number'
        ? { maxOutputTokens: params.tokenUsageContext.maxOutputTokens }
        : {}),
      ...(typeof params.tokenUsageContext?.model === 'string'
        ? { model: params.tokenUsageContext.model }
        : {}),
      ...(typeof params.tokenUsageContext?.providerType === 'string'
        ? { providerType: params.tokenUsageContext.providerType }
        : {}),
      ...(typeof params.tokenUsageContext?.providerId === 'string'
        ? { providerId: params.tokenUsageContext.providerId }
        : {}),
    });
  };
  let finalText = fullResponse;
  if (agentResult?.response && agentResult.response.trim()) {
    finalText = agentResult.response;
  }

  if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
    emitTokenUsage(agentResult.usage);
    params.registerApprovalBatch(agentResult.toolApprovalRequests, {
      harness: params.harness,
      webContents: params.webContents,
      history: params.harness.getHistory?.() ?? params.history,
      ...(params.approvalContext ? { recoveryContext: params.approvalContext } : {}),
    });
    return { awaitingApproval: true, usage: agentResult.usage };
  }

  if (!finalText.trim() && fullResponse.trim()) {
    finalText = fullResponse;
  }

  if (finalText.trim()) {
    let missingText = '';
    if (!fullResponse) {
      missingText = finalText;
    } else if (finalText.startsWith(fullResponse)) {
      missingText = finalText.slice(fullResponse.length);
    }

    if (missingText) {
      fullResponse += missingText;
      params.uiChunkEmitter?.emitTextDelta(missingText);
    }
  }

  emitTokenUsage(agentResult?.usage);
  params.uiChunkEmitter?.finish();
  return {
    awaitingApproval: false,
    ...(finalText.trim() ? { response: finalText } : {}),
    usage: agentResult?.usage,
  };
};
