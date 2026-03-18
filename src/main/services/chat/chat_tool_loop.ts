import type { ToolApprovalResponse } from 'ai';

import type { SimpleAgent, AgentResult } from '../../../core/agent';
import { getErrorMessage } from '../../utils/errors';
import { shouldLogChunk } from './chat_constants';
import type { ChatWebContents, ToolStreamEvent, UiChunkEmitter } from './chat_types';

export type RegisterApprovalBatch = (
  approvalRequests: Array<{ approvalId: string }>,
  session: { agent: SimpleAgent; webContents: ChatWebContents }
) => void;

export type ToolLoopStreamParams = {
  agent: SimpleAgent;
  webContents: ChatWebContents;
  prompt: string;
  approvalResponses?: ToolApprovalResponse[];
  shouldCancel?: () => boolean;
  debugLabel?: string;
  onToolEvent?: (event: ToolStreamEvent) => void;
  abortSignal?: AbortSignal;
  uiChunkEmitter?: UiChunkEmitter;
};

export type ToolLoopStreamResult = {
  awaitingApproval: boolean;
  cancelled?: boolean;
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

const streamToolLoop = async (params: ToolLoopStreamParams & { registerApprovalBatch: RegisterApprovalBatch }) => {
  const generator = params.agent.stream(
    params.prompt,
    params.approvalResponses,
    params.onToolEvent,
    params.abortSignal
  );
  let fullResponse = '';
  let chunkCount = 0;
  let chunkChars = 0;
  const startedAt = Date.now();
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
          console.warn('[Main] Failed to close cancelled tool stream:', error);
        }
        break;
      }

      const chunk = next.value;
      if (typeof chunk === 'string' && chunk) {
        chunkCount += 1;
        chunkChars += chunk.length;
        if (params.debugLabel && shouldLogChunk(chunkCount)) {
          console.log(
            `[StreamDebug][Main][Agent][${params.debugLabel}] chunk#${chunkCount} len=${chunk.length} totalChars=${chunkChars}`
          );
        }
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
        console.warn('[Main] Failed to close aborted tool stream:', returnError);
      }
    } else {
      params.uiChunkEmitter?.error(getErrorMessage(error));
      throw error;
    }
  }

  if (cancelled || !next) {
    if (params.debugLabel) {
      console.log(
        `[StreamDebug][Main][Agent][${params.debugLabel}] cancelled chunkCount=${chunkCount} totalChars=${chunkChars} durationMs=${Date.now() - startedAt}`
      );
    }
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
      agent: params.agent,
      webContents: params.webContents,
    });
    return { awaitingApproval: true };
  }

  if (!finalText.trim() && fullResponse.trim()) {
    finalText = fullResponse;
  }

  if (params.debugLabel) {
    console.log(
      `[StreamDebug][Main][Agent][${params.debugLabel}] done chunkCount=${chunkCount} totalChars=${chunkChars} finalTextLen=${(finalText || '').length} durationMs=${Date.now() - startedAt}`
    );
  }
  params.uiChunkEmitter?.finish();
  return { awaitingApproval: false };
};
