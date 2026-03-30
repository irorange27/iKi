import type { ModelMessage, ToolApprovalResponse } from 'ai';

import type { ConversationRunner, AgentResult, ToolApprovalRequest } from '../../../core/agent';
import { createLogger } from '../../../core/logger';
import { getErrorMessage } from '../../utils/errors';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import type { ChatWebContents, ToolStreamEvent, UiChunkEmitter } from './chat_types';

const chatToolLoopLogger = createLogger({ module: 'chat_tool_loop' });

export type RegisterApprovalBatch = (
  approvalRequests: ToolApprovalRequest[],
  session: {
    runner: ConversationRunner;
    webContents: ChatWebContents;
    recoveryContext?: ApprovalRecoveryContext;
  }
) => void;

export type ToolLoopStreamParams = {
  runner: ConversationRunner;
  webContents: ChatWebContents;
  history?: ModelMessage[];
  prompt: string;
  approvalResponses?: ToolApprovalResponse[];
  shouldCancel?: () => boolean;
  onToolEvent?: (event: ToolStreamEvent) => void;
  abortSignal?: AbortSignal;
  uiChunkEmitter?: UiChunkEmitter;
  approvalContext?: ApprovalRecoveryContext;
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
  const generator = params.runner.stream({
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
  let finalText = fullResponse;
  if (agentResult?.response && agentResult.response.trim()) {
    finalText = agentResult.response;
  }

  if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
    params.registerApprovalBatch(agentResult.toolApprovalRequests, {
      runner: params.runner,
      webContents: params.webContents,
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

  params.uiChunkEmitter?.finish();
  return {
    awaitingApproval: false,
    ...(finalText.trim() ? { response: finalText } : {}),
    usage: agentResult?.usage,
  };
};
