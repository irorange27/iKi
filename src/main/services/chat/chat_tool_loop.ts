import type { ModelMessage, ToolApprovalResponse } from 'ai';

import type { AgentResult, ConversationHarness, ToolApprovalRequest } from '../../../core/agent';
import type { TokenUsagePartData } from '../../../shared/chat/message_parts';
import { createLogger } from '../../../core/logger';
import { getErrorMessage, isRetryableError, RefusalError } from '../../utils/errors';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import type { ChatWebContents, ToolStreamEvent, UiChunkEmitter } from './chat_types';

const chatToolLoopLogger = createLogger({ module: 'chat_tool_loop' });

const MAX_TOOL_LOOP_ITERATIONS = 10_000;

export type RegisterApprovalBatch = (
  approvalRequests: ToolApprovalRequest[],
  session: {
    harness: ConversationHarness;
    webContents: ChatWebContents;
    history?: ModelMessage[];
    recoveryContext?: ApprovalRecoveryContext;
  }
) => void;

export type ToolLoopAutonomousOptions = {
  maxIterations: number;
  continuePrompt?: string;
};

export type ToolLoopRetryOptions = {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type ToolLoopStreamParams = {
  harness: ConversationHarness;
  webContents: ChatWebContents;
  history?: ModelMessage[];
  prompt: string;
  approvalResponses?: ToolApprovalResponse[];
  shouldCancel?: () => boolean;
  isSteered?: () => boolean;
  clearSteered?: () => void;
  onToolEvent?: (event: ToolStreamEvent) => void;
  abortSignal?: AbortSignal;
  uiChunkEmitter?: UiChunkEmitter;
  approvalContext?: ApprovalRecoveryContext;
  tokenUsageContext?: Pick<
    TokenUsagePartData,
    'maxInputTokens' | 'maxOutputTokens' | 'model' | 'providerType' | 'providerId'
  >;
  maxStreamIterations?: number;
  autonomous?: ToolLoopAutonomousOptions;
  retry?: ToolLoopRetryOptions;
  steerQueue?: string[];
};

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

const TERMINAL_TOOL_NAMES = new Set(['finish', 'handoff']);

const SLEEP = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const runSingleHarnessStream = async (
  params: ToolLoopStreamParams & { registerApprovalBatch: RegisterApprovalBatch },
  overrides: {
    history?: ModelMessage[];
    prompt: string;
    approvalResponses?: ToolApprovalResponse[];
  }
): Promise<{
  cancelled: boolean;
  steered: boolean;
  fullResponse: string;
  agentResult: AgentResult | null;
  terminalToolName: string | null;
}> => {
  const maxAttempts = params.retry?.maxAttempts ?? 0;
  const baseDelayMs = params.retry?.baseDelayMs ?? 1000;
  const maxDelayMs = params.retry?.maxDelayMs ?? 30000;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    let terminalToolName: string | null = null;
    let steered = false;

    const wrappedOnToolEvent = (event: ToolStreamEvent) => {
      if (event.type === 'tool-call') {
        const toolName =
          typeof event.toolName === 'string'
            ? event.toolName
            : event.toolCall && typeof event.toolCall === 'object'
              ? (event.toolCall as Record<string, unknown>).toolName
              : undefined;
        if (typeof toolName === 'string' && TERMINAL_TOOL_NAMES.has(toolName)) {
          terminalToolName = toolName;
        }
      }
      params.onToolEvent?.(event);
    };

    try {
      const generator = params.harness.stream({
        history: overrides.history,
        prompt: overrides.prompt,
        approvalResponses: overrides.approvalResponses,
        onStreamPart: wrappedOnToolEvent,
        abortSignal: params.abortSignal,
      });

      let fullResponse = '';
      let cancelled = false;
      let next: IteratorResult<string, AgentResult> | null = null;
      let loopIterations = 0;

      try {
        next = await generator.next();
        while (!next.done) {
          loopIterations += 1;
          const limit = params.maxStreamIterations ?? MAX_TOOL_LOOP_ITERATIONS;
          if (loopIterations > limit) {
            chatToolLoopLogger.event({
              level: 'error',
              event: 'chat.tool_stream.loop_limit',
              outcome: 'failed',
              message: `Tool loop exceeded hard iteration limit of ${limit}.`,
            });
            cancelled = true;
            try {
              await generator.return(undefined);
            } catch (returnError) {
              chatToolLoopLogger.event({
                level: 'warn',
                event: 'chat.tool_stream.close',
                outcome: 'degraded',
                error: returnError,
                message: 'Failed to close tool stream after hitting iteration limit.',
              });
            }
            break;
          }
          if (params.shouldCancel?.()) {
            if (params.isSteered?.()) {
              steered = true;
            } else {
              cancelled = true;
            }
            try {
              await generator.return(undefined);
            } catch (error) {
              chatToolLoopLogger.event({
                level: 'warn',
                event: 'chat.tool_stream.close',
                outcome: 'degraded',
                error,
                message: 'Failed to close interrupted tool stream.',
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
          if (params.isSteered?.()) {
            steered = true;
          } else {
            cancelled = true;
          }
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
          throw error;
        }
      }

      return {
        cancelled,
        steered,
        fullResponse,
        agentResult: cancelled || steered || !next ? null : ((next.value ?? null) as AgentResult | null),
        terminalToolName,
      };
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        params.uiChunkEmitter?.error(getErrorMessage(error));
        throw error;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      let recoveryNote: string;
      if (error instanceof RefusalError) {
        recoveryNote = 'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.';
      } else {
        recoveryNote = `Your last attempt encountered an error: ${getErrorMessage(error)}. Please try a different approach or simplify your response to avoid this issue.`;
      }

      overrides.prompt = `${recoveryNote}\n\n---\nContinue with the original task:\n${overrides.prompt}`;

      chatToolLoopLogger.event({
        level: 'warn',
        event: 'chat.tool_stream.retry',
        outcome: 'started',
        message: `Harness stream failed, retrying (attempt ${attempt + 1}/${maxAttempts + 1}) after ${delay}ms`,
        error,
      });
      await SLEEP(delay);
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw new Error('Unreachable: retry loop exhausted');
};

/**
 * Compact history to reduce token usage during long autonomous runs.
 * Drops the oldest ~50% of non-tool messages, keeping tool-call/tool-result pairs intact
 * and preserving the most recent messages.
 */
const compactHistoryForAutonomous = (history?: ModelMessage[]): ModelMessage[] => {
  if (!history || history.length <= 6) return history ?? [];

  const keepCount = Math.max(4, Math.floor(history.length / 2));
  const startIndex = history.length - keepCount;

  // Walk back to include the tool-call preceding the first kept tool-result
  let adjustedStart = startIndex;
  while (adjustedStart > 0) {
    const msg = history[adjustedStart];
    if (
      msg &&
      msg.role === 'tool' &&
      Array.isArray(msg.content) &&
      msg.content.some(
        part => typeof part === 'object' && part !== null && (part as Record<string, unknown>).type === 'tool-result'
      )
    ) {
      // Include the preceding assistant message with the tool-call
      const prev = history[adjustedStart - 1];
      if (prev && prev.role === 'assistant') {
        adjustedStart -= 1;
      }
    }
    break;
  }

  return history.slice(Math.max(0, adjustedStart));
};

const emitTokenUsage = (
  uiChunkEmitter: UiChunkEmitter | undefined,
  usage: AgentResult['usage'] | undefined,
  tokenUsageContext: ToolLoopStreamParams['tokenUsageContext']
) => {
  if (!usage || !uiChunkEmitter) return;
  uiChunkEmitter.emitTokenUsage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    ...(typeof tokenUsageContext?.maxInputTokens === 'number'
      ? { maxInputTokens: tokenUsageContext.maxInputTokens }
      : {}),
    ...(typeof tokenUsageContext?.maxOutputTokens === 'number'
      ? { maxOutputTokens: tokenUsageContext.maxOutputTokens }
      : {}),
    ...(typeof tokenUsageContext?.model === 'string'
      ? { model: tokenUsageContext.model }
      : {}),
    ...(typeof tokenUsageContext?.providerType === 'string'
      ? { providerType: tokenUsageContext.providerType }
      : {}),
    ...(typeof tokenUsageContext?.providerId === 'string'
      ? { providerId: tokenUsageContext.providerId }
      : {}),
  });
};

const streamToolLoop = async (
  params: ToolLoopStreamParams & { registerApprovalBatch: RegisterApprovalBatch }
) => {
  const maxAutonomousIterations = params.autonomous?.maxIterations ?? 1;
  const continuePrompt = params.autonomous?.continuePrompt ?? 'Continue with the next step.';

  let autonomousIteration = 0;
  let currentHistory = params.history;
  let currentPrompt = params.prompt;
  let currentApprovalResponses = params.approvalResponses;
  let allStreamedText = '';
  let allText = '';
  let cumulativeUsage: AgentResult['usage'] | undefined;
  let lastAgentResult: AgentResult | null = null;
  let lastTerminalToolName: string | null = null;
  let wasCancelled = false;

  while (autonomousIteration < maxAutonomousIterations) {
    if (params.steerQueue && params.steerQueue.length > 0) {
      const steerMessages: string[] = [];
      while (params.steerQueue.length > 0) {
        const msg = params.steerQueue.shift();
        if (msg !== undefined) steerMessages.push(msg);
      }
      if (steerMessages.length > 0) {
        const steerPrompt = steerMessages.length === 1
          ? steerMessages[0]
          : steerMessages.join('\n\n---\n\n');
        currentHistory = [
          ...(params.harness.getHistory?.() ?? currentHistory ?? []),
          { role: 'user' as const, content: `[STEERING INPUT]\n\n${steerPrompt}` },
        ];
        currentPrompt = 'Acknowledged. Continuing with the updated direction.';
        chatToolLoopLogger.event({
          level: 'info',
          event: 'chat.tool_stream.steer',
          outcome: 'succeeded',
          message: `Applied ${steerMessages.length} steering message(s) at autonomous iteration ${autonomousIteration + 1}.`,
        });
      }
      params.clearSteered?.();
    }

    let cancelled = false;
    let steered = false;
    let fullResponse = '';
    let agentResult: AgentResult | null = null;
    let terminalToolName: string | null = null;

    try {
      const streamOutput = await runSingleHarnessStream(
        params,
        {
          history: currentHistory,
          prompt: currentPrompt,
          approvalResponses: currentApprovalResponses,
        }
      );
      cancelled = streamOutput.cancelled;
      steered = streamOutput.steered;
      fullResponse = streamOutput.fullResponse;
      agentResult = streamOutput.agentResult;
      terminalToolName = streamOutput.terminalToolName;
    } catch (error) {
      chatToolLoopLogger.event({
        level: 'error',
        event: 'chat.tool_stream.iteration_error',
        outcome: 'failed',
        message: `Autonomous iteration ${autonomousIteration + 1} failed: ${getErrorMessage(error)}`,
        error,
      });
      if (allText || allStreamedText) {
        const partialText = allText || allStreamedText || '(partial output unavailable)';
        params.uiChunkEmitter?.emitTextDelta(
          `\n\n[Autonomous iteration ${autonomousIteration + 1} failed: ${getErrorMessage(error)}]\n\nPartial results saved from ${autonomousIteration} completed iteration(s).`
        );
        params.uiChunkEmitter?.finish();
        return {
          awaitingApproval: false,
          partialFailure: true,
          response: partialText,
          usage: cumulativeUsage,
        };
      }
      throw error;
    }

    if (steered) {
      continue;
    }

    if (cancelled) {
      wasCancelled = true;
      break;
    }

    lastAgentResult = agentResult;

    if (agentResult?.usage) {
      emitTokenUsage(params.uiChunkEmitter, agentResult.usage, params.tokenUsageContext);
      if (cumulativeUsage) {
        cumulativeUsage = {
          inputTokens: (cumulativeUsage.inputTokens ?? 0) + (agentResult.usage.inputTokens ?? 0),
          outputTokens: (cumulativeUsage.outputTokens ?? 0) + (agentResult.usage.outputTokens ?? 0),
          totalTokens: (cumulativeUsage.totalTokens ?? 0) + (agentResult.usage.totalTokens ?? 0),
          cacheReadTokens: (cumulativeUsage.cacheReadTokens ?? 0) + (agentResult.usage.cacheReadTokens ?? 0),
          cacheWriteTokens: (cumulativeUsage.cacheWriteTokens ?? 0) + (agentResult.usage.cacheWriteTokens ?? 0),
          reasoningTokens: (cumulativeUsage.reasoningTokens ?? 0) + (agentResult.usage.reasoningTokens ?? 0),
          estimatedCostUsd: (cumulativeUsage.estimatedCostUsd ?? 0) + (agentResult.usage.estimatedCostUsd ?? 0),
        };
      } else {
        cumulativeUsage = { ...agentResult.usage };
      }
    }

    allStreamedText += fullResponse;
    if (agentResult?.response && agentResult.response.trim()) {
      allText += (allText ? '\n\n' : '') + agentResult.response.trim();
    }

    if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
      params.registerApprovalBatch(agentResult.toolApprovalRequests, {
        harness: params.harness,
        webContents: params.webContents,
        history: params.harness.getHistory?.() ?? currentHistory,
        ...(params.approvalContext ? { recoveryContext: params.approvalContext } : {}),
      });
      return { awaitingApproval: true, usage: cumulativeUsage };
    }

    // Context monitoring: check if approaching the model's input limit
    const maxInputTokens = params.tokenUsageContext?.maxInputTokens;
    if (
      maxInputTokens &&
      cumulativeUsage &&
      (cumulativeUsage.inputTokens ?? 0) > maxInputTokens * 0.75 &&
      autonomousIteration + 1 < maxAutonomousIterations
    ) {
      const prevHistory = currentHistory;
      currentHistory = compactHistoryForAutonomous(currentHistory);
      chatToolLoopLogger.event({
        level: 'warn',
        event: 'chat.tool_stream.context_compact',
        outcome: 'started',
        message: `Compacted history from ${prevHistory?.length ?? 0} to ${currentHistory?.length ?? 0} messages (${cumulativeUsage.inputTokens} input tokens vs ${maxInputTokens} limit).`,
      });
    }

    if (terminalToolName) {
      lastTerminalToolName = terminalToolName;
      chatToolLoopLogger.event({
        level: 'debug',
        event: terminalToolName === 'handoff'
          ? 'chat.tool_stream.handoff'
          : 'chat.tool_stream.autonomous_finish',
        outcome: 'succeeded',
        message: `Autonomous run terminated by agent (${terminalToolName}) after ${autonomousIteration + 1} iteration(s).`,
      });
      break;
    }

    autonomousIteration++;
    if (autonomousIteration >= maxAutonomousIterations) break;

    currentHistory = params.harness.getHistory?.() ?? currentHistory;
    currentPrompt = continuePrompt;
    currentApprovalResponses = undefined;
  }

  if (wasCancelled) {
    params.uiChunkEmitter?.abort();
    return { awaitingApproval: false, cancelled: true };
  }

  let finalText = allText || lastAgentResult?.response || '';

  if (!finalText.trim() && allStreamedText.trim()) {
    finalText = allStreamedText;
  }

  if (finalText.trim()) {
    let missingText = '';
    if (!allStreamedText) {
      missingText = finalText;
    } else if (finalText.startsWith(allStreamedText)) {
      missingText = finalText.slice(allStreamedText.length);
    }

    if (missingText) {
      params.uiChunkEmitter?.emitTextDelta(missingText);
    }
  }

  let handoff: ToolLoopStreamResult['handoff'] | undefined;
  if (lastTerminalToolName === 'handoff' && lastAgentResult?.toolCalls) {
    const handoffCall = lastAgentResult.toolCalls.find(
      (tc: { toolName: string; args?: Record<string, unknown> }) => tc.toolName === 'handoff'
    );
    if (handoffCall?.args) {
      handoff = {
        summary: typeof handoffCall.args.summary === 'string' ? handoffCall.args.summary : '',
        nextSteps: typeof handoffCall.args.next_steps === 'string' ? handoffCall.args.next_steps : '',
        reason: typeof handoffCall.args.reason === 'string' ? handoffCall.args.reason : 'other',
      };
    }
  }

  params.uiChunkEmitter?.finish();
  return {
    awaitingApproval: false,
    ...(finalText.trim() ? { response: finalText } : {}),
    usage: cumulativeUsage,
    ...(handoff ? { handoff } : {}),
    ...(lastTerminalToolName ? { finished: true } : {}),
  };
};
