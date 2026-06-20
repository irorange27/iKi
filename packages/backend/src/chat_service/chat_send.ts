import { createAgentRunTracker } from '../agent_session/run_tracker';
import { AgentHarness } from '../agent/harness';
import { createLogger } from '@iki/core/logger';
import * as llmFactory from '../provider/llm/factory';
import { runWithToolRuntimeContext } from '../tools/runtime_context';
import { getErrorMessage } from '@iki/core/utils/errors';
import { describeApprovalRequiredTools } from '../agent_session/approval_types';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveChatToolMaxIterations,
} from './constants';
import type { ChatTurnOptions } from '../agent_session/turn_preparer';
import type { createChatTurnPreparer } from '../agent_session/turn_preparer';
import { writeThreadTodoPlan } from '../db/thread_todos';

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
        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const harness = new AgentHarness({
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt,
          enableTools: true,
          enabledToolNames: preparedTurn.guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          guardActive: preparedTurn.guardActive,
          requireApproval: preparedTurn.requireApproval,
          autoApproveToolRequests: preparedTurn.autoApproveToolRequests,
          maxIterations,
          ...(typeof preparedTurn.maxOutputTokens === 'number'
            ? { maxOutputTokens: preparedTurn.maxOutputTokens }
            : {}),
        });

        // ponytail: clear stale todo plan from previous turn
        writeThreadTodoPlan({ threadId: options.threadId, items: [] });

        const output = await runWithToolRuntimeContext(
          {
            runId: runTracker.id,
            runTracker,
            threadId: options.threadId,
            conversationModel: {
              providerType: options.providerType,
              providerId: options.providerId,
              model: options.model,
            },
          },
          async () => {
            for await (const event of harness.turn({
              prompt: preparedTurn.prompt,
              history: preparedTurn.history,
              runTracker,
            })) {
              if (event.event === 'done') return event.output;
            }
            throw new Error('Agent harness produced no output');
          }
        );

        runTracker.recordToolCalls(output.toolCalls);
        // harness.turn() already calls runTracker.syncModelMessages() internally
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: output.usage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            approvalRequestCount: output.toolApprovalRequests?.length ?? 0,
          },
        });
        if (output.toolApprovalRequests && output.toolApprovalRequests.length > 0) {
          const approvalError = describeApprovalRequiredTools(output.toolApprovalRequests);
          runTracker.markBlocked({
            text: output.text,
            usage: output.usage ? { ...output.usage } : undefined,
            pendingApprovalIds: output.toolApprovalRequests.map(request => request.approvalId),
          });
          logger.event({
            level: 'warn',
            event: 'chat.send.approval_required',
            outcome: 'denied',
            message: approvalError,
            data: {
              thread_id: options.threadId || null,
              tool_names: output.toolApprovalRequests
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
          text: output.text,
          usage: output.usage ? { ...output.usage } : undefined,
          finishReason: 'completed',
        });
        return {
          success: true,
          text: output.text,
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
