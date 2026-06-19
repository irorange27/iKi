import type { AgentResult } from '@iki/core/agent';
import { createAgentRunTracker } from '../agent/run_tracker';
import { createLogger } from '@iki/core/logger';
import * as llmFactory from '@iki/core/provider/llm/factory';
import { runWithToolRuntimeContext } from '@iki/core/tools/runtime_context';
import { getErrorMessage } from '@iki/core/utils/errors';
import { describeApprovalRequiredTools } from './approval_types';
import { createChatAgentRunner } from './chat_agent_runner';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveChatToolMaxIterations,
} from './constants';
import type { ChatTurnOptions } from './turn_preparer';
import type { createChatTurnPreparer } from './turn_preparer';

const logger = createLogger({ module: 'chat_send' });

export type ChatSendResult =
  | {
      success: true;
      text: string;
      runId?: string;
    }
  | {
      success: false;
      error: string;
      runId?: string;
    };

export type ChatSendDeps = {
  turnPreparer: ReturnType<typeof createChatTurnPreparer>;
  usage: {
    recordUsageEvent: (params: {
      threadId?: string;
      messageId?: string;
      providerType: string;
      model: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
        estimatedCostUsd?: number;
      };
      source?: string;
      metadata?: Record<string, unknown>;
    }) => void;
  };
  checkThreadRunRate: (threadId: string) => { allowed: boolean; retryAfterMs?: number };
};

export const createChatSend = (deps: ChatSendDeps) => {
  const send = async (options: ChatTurnOptions): Promise<ChatSendResult> => {
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    try {
      if (options.threadId) {
        const rateCheck = deps.checkThreadRunRate(options.threadId);
        if (!rateCheck.allowed) {
          return {
            success: false,
            error: `Too many requests on this thread. Retry in ${Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000)}s.`,
          };
        }
      }

      const preparedTurn = await deps.turnPreparer.prepareChatTurn(options);
      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);
      const systemPrompt = preparedTurn.enableTools
        ? TOOL_AGENT_SYSTEM_PROMPT
        : NO_TOOLS_SYSTEM_PROMPT;

      runTracker = createAgentRunTracker({
        kind: options.runConfig?.kind ?? 'chat-turn',
        threadId: options.threadId,
        parentRunId: options.runConfig?.parentRunId,
        rootRunId: options.runConfig?.rootRunId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enabledTools: preparedTurn.guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        input: {
          ...(preparedTurn.prompt.trim() ? { prompt: preparedTurn.prompt } : {}),
          messages: preparedTurn.finalMessages,
          metadata: {
            ...(options.runConfig?.metadata ?? {}),
            transport: 'send',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            skillMode: preparedTurn.skillMode,
            maxIterations,
            enableTools: preparedTurn.enableTools,
          },
        },
        working: {
          modelMessages: preparedTurn.history,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      });

      if (preparedTurn.enableTools) {
        const { runner, tools: runnerTools } = createChatAgentRunner({
          threadId: options.threadId,
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt,
          enableTools: true,
          enabledTools: preparedTurn.guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          guardActive: preparedTurn.guardActive,
          maxIterations,
          ...(typeof preparedTurn.maxOutputTokens === 'number'
            ? { maxOutputTokens: preparedTurn.maxOutputTokens }
            : {}),
        });

        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const result = await runWithToolRuntimeContext(
          { runId: runTracker.id, runTracker, threadId: options.threadId },
          async () => {
            const agentGen = runner.run({
              config: { enabled: true, enableTools: true },
              prompt: preparedTurn.prompt,
              history: preparedTurn.history,
              tools: runnerTools,
              providerType: options.providerType,
              providerId: options.providerId,
              model: options.model,
              systemPrompt,
              maxIterations,
              ...(typeof preparedTurn.maxOutputTokens === 'number'
                ? { maxTokens: preparedTurn.maxOutputTokens }
                : {}),
            });

            let next = await agentGen.next();
            while (!next.done) {
              next = await agentGen.next();
            }
            return next.value as AgentResult | undefined;
          }
        );

        if (!result) {
          throw new Error('Agent run produced no result');
        }

        runTracker.recordToolCalls(result.toolCalls);
        runTracker.syncModelMessages(runner.getHistory?.() ?? preparedTurn.history);
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: result.usage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            approvalRequestCount: result.toolApprovalRequests?.length ?? 0,
          },
        });
        if (result.toolApprovalRequests && result.toolApprovalRequests.length > 0) {
          const approvalError = describeApprovalRequiredTools(result.toolApprovalRequests);
          runTracker.markBlocked({
            text: result.response,
            usage: result.usage ? { ...result.usage } : undefined,
            pendingApprovalIds: result.toolApprovalRequests.map(request => request.approvalId),
          });
          logger.event({
            level: 'warn',
            event: 'chat.send.approval_required',
            outcome: 'denied',
            message: approvalError,
            data: {
              thread_id: options.threadId || null,
              tool_names: result.toolApprovalRequests
                .map(request => request.toolCall?.toolName)
                .filter(
                  (toolName): toolName is string =>
                    typeof toolName === 'string' && toolName.trim().length > 0
                ),
            },
          });
          throw new Error(approvalError);
        }
        runTracker.markCompleted({
          text: result.response,
          usage: result.usage ? { ...result.usage } : undefined,
          finishReason: 'completed',
        });
        return {
          success: true,
          text: result.response,
          ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
        };
      }

      const llmResult = await llmFactory.generateChatWithModelMessages({
        providerType: options.providerType,
        providerId: options.providerId,
        modelId: options.model,
        messages: preparedTurn.finalMessages,
        extraSystemPrompt: NO_TOOLS_SYSTEM_PROMPT,
        ...(typeof preparedTurn.maxOutputTokens === 'number'
          ? { maxOutputTokens: preparedTurn.maxOutputTokens }
          : {}),
      });
      deps.usage.recordUsageEvent({
        threadId: options.threadId,
        providerType: options.providerType,
        model: options.model,
        usage: llmResult.usage,
        source: 'chat.send.llm',
        metadata: {
          contextTokens: preparedTurn.report.totalEstimatedTokens,
        },
      });
      runTracker.markCompleted({
        text: llmResult.text,
        usage: llmResult.usage ? { ...llmResult.usage } : undefined,
        finishReason: 'completed',
      });
      return {
        success: true,
        text: llmResult.text,
        ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (runTracker && runTracker.getRun().status === 'running') {
        runTracker.markFailed({ message });
      }
      return {
        success: false,
        error: message,
        ...(options.runConfig?.kind && runTracker ? { runId: runTracker.id } : {}),
      };
    }
  };

  return { send };
};

export type ChatSend = ReturnType<typeof createChatSend>;
