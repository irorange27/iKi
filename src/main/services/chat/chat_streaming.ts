import type { ConversationHarness } from '../../../core/agent';
import { createLogger } from '../../../core/logger';
import * as llmFactory from '../../../core/provider/llm/factory';
import { runWithToolRuntimeContext } from '../../../core/tools/runtime_context';
import { getErrorMessage } from '../../utils/errors';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveChatToolMaxIterations,
} from './chat_constants';
import type { ChatMemory } from './chat_memory';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import * as agentRunDb from '../../../core/db/agent_runs';
import { createAgentRunTracker } from './chat_run_tracking';
import {
  createApprovalRecoveryContext,
  createChatHarness,
  describeApprovalRequiredTools,
} from './chat_streaming_harness';
import { createChatStreamingModels } from './chat_streaming_models';
import { createChatTurnPreparer, type ChatTurnOptions } from './chat_turn_preparer';
import type { ActiveStreamState, ChatWebContents, RunStatusEvent } from './chat_types';
import { createUiChunkEmitter, toLlmChatMessages } from './chat_ui';
import { createToolLoopRunner, type RegisterApprovalBatch } from './chat_tool_loop';
import { companionService } from '../companion/companion_service';
import { createRateLimiter } from '../../../daemon/rate_limiter';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;

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

export const createChatStreaming = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
  memory: ChatMemory;
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
  approvals: {
    ensurePendingApprovalSession: (
      approvalId: string,
      session: {
        harness: ConversationHarness;
        webContents: ChatWebContents;
        history?: import('ai').ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
    cleanupPendingSessionsForWebContents: (senderId: number) => void;
  };
}) => {
  const toolLoopRunner = createToolLoopRunner({
    registerApprovalBatch: deps.approvals.registerApprovalBatch,
  });
  const turnPreparer = createChatTurnPreparer({ memory: deps.memory });
  const streamingModels = createChatStreamingModels();

  const threadStreams = new Map<string, Set<number>>();
  const steerQueues = new Map<number, string[]>();
  const threadRunLimiter = createRateLimiter({
    windowMs: THREAD_RATE_LIMIT_WINDOW_MS,
    maxRequests: THREAD_RATE_LIMIT_MAX_REQUESTS,
  });

  const checkThreadRunRate = (threadId: string): { allowed: boolean; retryAfterMs?: number } => {
    if (!threadId) return { allowed: true };
    return threadRunLimiter.check(threadId);
  };

  const cancelThreadStreams = (threadId: string, exceptSenderId?: number) => {
    const senderIds = threadStreams.get(threadId);
    if (!senderIds || senderIds.size === 0) return;
    for (const senderId of senderIds) {
      if (senderId === exceptSenderId) continue;
      const streamState = deps.activeStreams.get(senderId);
      if (streamState && !streamState.cancelled) {
        streamState.cancelled = true;
        streamState.stoppedByUser = true;
        streamState.abortController.abort('superseded-by-same-thread');
      }
    }
  };

  const trackThreadStream = (threadId: string, senderId: number) => {
    const senderIds = threadStreams.get(threadId);
    if (senderIds) {
      senderIds.add(senderId);
    } else {
      threadStreams.set(threadId, new Set([senderId]));
    }
  };

  const untrackThreadStream = (threadId: string, senderId: number) => {
    const senderIds = threadStreams.get(threadId);
    if (!senderIds) return;
    senderIds.delete(senderId);
    if (senderIds.size === 0) {
      threadStreams.delete(threadId);
    }
  };

  const stopStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (!streamState) {
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    steerQueues.delete(senderId);
    return { success: true };
  };

  const steerStream = (senderId: number, message: string): { success: boolean; error?: string } => {
    const steerQueue = steerQueues.get(senderId);
    if (!steerQueue) {
      return { success: false, error: 'No active autonomous stream to steer' };
    }
    steerQueue.push(message);
    const streamState = deps.activeStreams.get(senderId);
    if (streamState && !streamState.cancelled) {
      streamState.steered = true;
      streamState.abortController.abort('steer');
    }
    return { success: true };
  };

  const send = async (options: ChatTurnOptions): Promise<ChatSendResult> => {
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    try {
      if (options.threadId) {
        const rateCheck = checkThreadRunRate(options.threadId);
        if (!rateCheck.allowed) {
          return {
            success: false,
            error: `Too many requests on this thread. Retry in ${Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000)}s.`,
          };
        }
      }

      const preparedTurn = await turnPreparer.prepareChatTurn(options);
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
        const harness = createChatHarness({
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
          { runId: runTracker.id, runTracker },
          async () =>
            await harness.generate({
              history: preparedTurn.history,
              prompt: preparedTurn.prompt,
            })
        );
        runTracker.recordToolCalls(result.toolCalls);
        runTracker.syncModelMessages(harness.getHistory?.() ?? preparedTurn.history);
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
          chatStreamingLogger.event({
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

      const llmResult = await llmFactory.generateChatWithUsage({
        providerType: options.providerType,
        providerId: options.providerId,
        modelId: options.model,
        messages: toLlmChatMessages(preparedTurn.finalMessages),
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

  const stream = async (webContents: ChatWebContents, options: ChatTurnOptions) => {
    const senderId = webContents.id;
    const existingStream = deps.activeStreams.get(senderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('superseded-by-new-request');
    }

    const uiChunkEmitter = createUiChunkEmitter(webContents);

    if (options.threadId) {
      const rateCheck = checkThreadRunRate(options.threadId);
      if (!rateCheck.allowed) {
        const delaySec = Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000);
        uiChunkEmitter.error(`Too many requests on this thread. Retry in ${delaySec}s.`);
        return { success: false, error: `Too many requests on this thread. Retry in ${delaySec}s.` };
      }
    }

    if (options.threadId) {
      cancelThreadStreams(options.threadId, senderId);
      trackThreadStream(options.threadId, senderId);
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const companionThinkingKey = `renderer:${senderId}:${Date.now().toString(36)}`;
    deps.activeStreams.set(senderId, streamState);
    const steerQueue: string[] = [];
    steerQueues.set(senderId, steerQueue);
    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;

    const notifyRunStatus = () => {
      const run = runTracker?.getRun();
      if (!run) return;
      webContents.send('chat:run-status', {
        runId: run.id,
        status: run.status,
        threadId: run.threadId,
        timestamp: run.updatedAt,
      } satisfies RunStatusEvent);
    };

    try {
      const preparedTurn = await turnPreparer.prepareChatTurn({
        ...options,
        onMemoryRetrieved: payload => {
          uiChunkEmitter.emitMemoryRetrieval({
            query: payload.query,
            results: payload.results,
          });
        },
      });
      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);
      const autonomousMode = options.autonomous && options.autonomous.maxIterations > 1;
      const guardedTools = autonomousMode
        ? [...new Set([...preparedTurn.guardedTools, 'finish'])]
        : preparedTurn.guardedTools;

      if (preparedTurn.usedSkills.length > 0) {
        uiChunkEmitter.emitSkillUsage({
          mode: preparedTurn.skillMode,
          skills: preparedTurn.usedSkills.map(skill => ({
            id: skill.id,
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
            ...(skill.source ? { source: skill.source } : {}),
          })),
        });
      }

      if (preparedTurn.affectSignal) {
        uiChunkEmitter.emitAffectSignal(preparedTurn.affectSignal);
      }

      companionService.setChatPolicy(preparedTurn.interventionPolicy);

      const systemPrompt = preparedTurn.enableTools
        ? TOOL_AGENT_SYSTEM_PROMPT
        : NO_TOOLS_SYSTEM_PROMPT;

      let streamHistory = preparedTurn.history;
      let streamPrompt = preparedTurn.prompt;

      if (options.runConfig?.kind === 'handoff-resume' && options.runConfig?.parentRunId) {
        const checkpoint = agentRunDb.getLatestAgentRunCheckpoint(options.runConfig.parentRunId);
        if (checkpoint?.snapshot?.working?.modelMessages) {
          const checkpointMessages = checkpoint.snapshot.working.modelMessages as import('ai').ModelMessage[];
          if (checkpointMessages.length > 0) {
            let handoffSummary = '';
            let handoffNextSteps = '';
            let handoffReason = '';

            for (let i = checkpointMessages.length - 1; i >= 0; i--) {
              const msg = checkpointMessages[i] as Record<string, unknown>;
              if (msg.role !== 'assistant') continue;
              const content = msg.content;
              if (!Array.isArray(content)) continue;
              for (const part of content) {
                if (
                  typeof part === 'object' &&
                  part !== null &&
                  (part as Record<string, unknown>).type === 'tool-call' &&
                  (part as Record<string, unknown>).toolName === 'handoff'
                ) {
                  const args = (part as Record<string, unknown>).args as Record<string, unknown> | undefined;
                  if (args) {
                    handoffSummary = typeof args.summary === 'string' ? args.summary : '';
                    handoffNextSteps = typeof args.next_steps === 'string' ? args.next_steps : '';
                    handoffReason = typeof args.reason === 'string' ? args.reason : '';
                  }
                  break;
                }
              }
              if (handoffSummary || handoffNextSteps) break;
            }

            const handoffContextParts: string[] = [
              'You are resuming work from a previous agent run.',
            ];
            if (handoffSummary) {
              handoffContextParts.push(`\nSummary of previous work:\n${handoffSummary}`);
            }
            if (handoffNextSteps) {
              handoffContextParts.push(`\nNext steps to complete:\n${handoffNextSteps}`);
            }
            if (handoffReason) {
              handoffContextParts.push(`\nReason for handoff: ${handoffReason}`);
            }
            handoffContextParts.push('\nThe conversation history from the previous run is below. Continue the work based on what was done before.');

            streamHistory = [
              {
                role: 'system' as const,
                content: `[HANDOFF CONTEXT] ${handoffContextParts.join('')}`,
              },
              ...checkpointMessages,
              ...(preparedTurn.history.length > 0
                ? [
                    {
                      role: 'system' as const,
                      content: `[CURRENT THREAD] The following messages are from the current conversation thread:`,
                    } as import('ai').ModelMessage,
                    ...preparedTurn.history,
                  ]
                : []),
            ];
            streamPrompt = preparedTurn.prompt || 'Continue the work from where the previous agent left off.';
          }
        }
      }

      runTracker = createAgentRunTracker({
        kind: options.runConfig?.kind ?? 'chat-turn',
        threadId: options.threadId,
        parentRunId: options.runConfig?.parentRunId,
        rootRunId: options.runConfig?.rootRunId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enabledTools: guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        input: {
          ...(preparedTurn.prompt.trim() ? { prompt: preparedTurn.prompt } : {}),
          messages: preparedTurn.finalMessages,
          metadata: {
            ...(options.runConfig?.metadata ?? {}),
            transport: 'stream',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            skillMode: preparedTurn.skillMode,
            maxIterations,
            enableTools: preparedTurn.enableTools,
            assistantMessageId: uiChunkEmitter.messageId,
          },
        },
        working: {
          modelMessages: streamHistory,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      });
      streamState.runId = runTracker.id;

      let approvalContext = preparedTurn.enableTools
        ? createApprovalRecoveryContext({
            threadId: options.threadId,
            sessionId: uiChunkEmitter.messageId,
            runId: runTracker.id,
            providerType: options.providerType,
            providerId: options.providerId,
            model: options.model,
            systemPrompt,
            maxInputTokens: preparedTurn.maxInputTokens,
            maxOutputTokens: preparedTurn.maxOutputTokens,
            maxIterations,
            enabledTools: guardedTools,
            availableSkillIds: preparedTurn.selectedSkillIds,
            ...(autonomousMode ? { autonomous: options.autonomous } : {}),
          })
        : undefined;

      let harness = createChatHarness({
        threadId: options.threadId,
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enableTools: preparedTurn.enableTools,
        enabledTools: guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        guardActive: preparedTurn.guardActive,
        maxIterations,
        ...(typeof preparedTurn.maxOutputTokens === 'number'
          ? { maxOutputTokens: preparedTurn.maxOutputTokens }
          : {}),
      });

      if (!preparedTurn.prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      companionService.beginThinking(companionThinkingKey);

      const MAX_OUTER_AUTONOMOUS_BATCHES = 50;
      const MAX_HANDOFF_CHAIN = 5;
      let outerBatch = 0;
      let handoffChain = 0;
      let streamResult: Awaited<ReturnType<typeof toolLoopRunner.stream>> | undefined;
      let accumulatedResponse = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        streamResult = await runWithToolRuntimeContext(
          { runId: runTracker.id, runTracker },
          async () =>
            await toolLoopRunner.stream({
              harness,
              webContents,
              history: streamHistory,
              prompt: streamPrompt,
              approvalContext,
              autonomous: autonomousMode
                ? { maxIterations: options.autonomous?.maxIterations ?? 1, continuePrompt: options.autonomous?.continuePrompt ?? 'Continue with the next step.' }
                : undefined,
              retry: autonomousMode
                ? { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000 }
                : { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
              steerQueue: autonomousMode ? steerQueue : undefined,
              shouldCancel: () => streamState.cancelled || (streamState.steered ?? false),
              isSteered: () => (streamState.steered ?? false) && !streamState.cancelled,
              clearSteered: () => { streamState.steered = false; },
              onToolEvent: eventPart => {
                runTracker?.recordToolEvent(eventPart);
                if (
                  eventPart.type === 'tool-approval-request' &&
                  typeof eventPart.approvalId === 'string' &&
                  eventPart.approvalId.length > 0
                ) {
                  deps.approvals.ensurePendingApprovalSession(eventPart.approvalId, {
                    harness,
                    webContents,
                    history: preparedTurn.history,
                    recoveryContext: approvalContext,
                  });
                }
                uiChunkEmitter.emitToolEvent(eventPart);
              },
              abortSignal: streamState.abortController.signal,
              uiChunkEmitter,
              tokenUsageContext: {
                ...(typeof preparedTurn.maxInputTokens === 'number'
                  ? { maxInputTokens: preparedTurn.maxInputTokens }
                  : {}),
                ...(typeof preparedTurn.maxOutputTokens === 'number'
                  ? { maxOutputTokens: preparedTurn.maxOutputTokens }
                  : {}),
                model: options.model,
                providerType: options.providerType,
                ...(typeof options.providerId === 'string' && options.providerId.trim()
                  ? { providerId: options.providerId.trim() }
                  : {}),
              },
            })
        );

        if (streamResult.response) {
          accumulatedResponse = accumulatedResponse
            ? accumulatedResponse + '\n\n' + streamResult.response
            : streamResult.response;
        }

        runTracker.syncModelMessages(harness.getHistory?.() ?? streamHistory);

        if (streamResult.cancelled) break;
        if (streamResult.awaitingApproval) break;
        if (streamResult.partialFailure) break;
        if (streamResult.finished) break;

        if (streamResult.handoff) {
          const handoffText =
            (streamResult.response ? streamResult.response + '\n\n' : '') +
            `[Handoff #${handoffChain + 1}] ${streamResult.handoff.summary}`;
          accumulatedResponse = accumulatedResponse
            ? accumulatedResponse + '\n\n---\n\n' + handoffText
            : handoffText;

          runTracker.markCompleted({
            text: handoffText.trim() || undefined,
            usage: streamResult.usage ? { ...streamResult.usage } : undefined,
            finishReason: 'handoff',
          });
          notifyRunStatus();

          handoffChain++;
          if (handoffChain >= MAX_HANDOFF_CHAIN || !autonomousMode) break;

          const parentRunId = runTracker.id;
          const rootRunId = runTracker.getRun().rootRunId;

          runTracker = createAgentRunTracker({
            kind: 'handoff-resume',
            threadId: options.threadId,
            parentRunId,
            rootRunId,
            providerType: options.providerType,
            providerId: options.providerId,
            model: options.model,
            systemPrompt,
            enabledTools: guardedTools,
            availableSkillIds: preparedTurn.selectedSkillIds,
            input: {
              prompt: streamResult.handoff.nextSteps || streamResult.handoff.summary,
              messages: [],
              metadata: {
                source: 'handoff',
                parentRunId,
                summary: streamResult.handoff.summary,
                nextSteps: streamResult.handoff.nextSteps,
                reason: streamResult.handoff.reason,
                handoffChain,
              },
            },
            working: {
              modelMessages: [],
              accumulatedText: '',
              pendingApprovalIds: [],
              lastStepIndex: 0,
            },
          });
          streamState.runId = runTracker.id;

          harness = createChatHarness({
            threadId: options.threadId,
            providerType: options.providerType,
            providerId: options.providerId,
            model: options.model,
            systemPrompt,
            enableTools: preparedTurn.enableTools,
            enabledTools: guardedTools,
            availableSkillIds: preparedTurn.selectedSkillIds,
            guardActive: preparedTurn.guardActive,
            maxIterations,
            ...(typeof preparedTurn.maxOutputTokens === 'number'
              ? { maxOutputTokens: preparedTurn.maxOutputTokens }
              : {}),
          });

          approvalContext = preparedTurn.enableTools
            ? createApprovalRecoveryContext({
                threadId: options.threadId,
                sessionId: uiChunkEmitter.messageId,
                runId: runTracker.id,
                providerType: options.providerType,
                providerId: options.providerId,
                model: options.model,
                systemPrompt,
                maxInputTokens: preparedTurn.maxInputTokens,
                maxOutputTokens: preparedTurn.maxOutputTokens,
                maxIterations,
                enabledTools: guardedTools,
                availableSkillIds: preparedTurn.selectedSkillIds,
                ...(autonomousMode ? { autonomous: options.autonomous } : {}),
              })
            : undefined;

          streamHistory = [
            {
              role: 'system',
              content: [
                '[HANDOFF CONTEXT] You are a fresh agent instance continuing work handed off from a previous agent.',
                '',
                `Summary of completed work:\n${streamResult.handoff.summary}`,
                '',
                `Next steps to complete:\n${streamResult.handoff.nextSteps}`,
                '',
                `Reason for handoff: ${streamResult.handoff.reason}`,
                '',
                'You have a clean context window. Start working on the next steps immediately.',
              ].join('\n'),
            },
          ];
          streamPrompt = streamResult.handoff.nextSteps || 'Continue the work from the handoff summary.';
          continue;
        }
        if (!autonomousMode) break;

        outerBatch++;
        if (outerBatch >= MAX_OUTER_AUTONOMOUS_BATCHES) break;

        if (outerBatch % 5 === 0) {
          runTracker.createCheckpoint('periodic');
        }

        streamHistory = harness.getHistory?.() ?? streamHistory;
        streamPrompt = options.autonomous?.continuePrompt || 'Continue with the next step.';
      }

      if (!streamResult) {
        throw new Error('Unreachable: stream loop produced no result');
      }

      if (!streamResult.cancelled) {
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          messageId: uiChunkEmitter.messageId,
          providerType: options.providerType,
          model: options.model,
          usage: streamResult.usage,
          source: 'chat.stream',
          metadata: {
            awaitingApproval: streamResult.awaitingApproval,
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            ...(outerBatch > 0 ? { autonomousBatches: outerBatch + 1 } : {}),
          },
        });
      }

      const finalResponse = accumulatedResponse || streamResult.response;

      if (streamResult.cancelled) {
        runTracker.markCancelled({
          ...(finalResponse ? { text: finalResponse } : {}),
        });
        notifyRunStatus();
      } else if (streamResult.partialFailure) {
        runTracker.markFailed({
          message: 'Autonomous iteration failed; partial progress saved.',
          retryable: true,
        });
        notifyRunStatus();
      } else if (streamResult.awaitingApproval) {
        runTracker.markBlocked({
          ...(finalResponse ? { text: finalResponse } : {}),
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
        });
        notifyRunStatus();
      } else if (streamResult.handoff) {
        const handoffResponse =
          (finalResponse ? finalResponse + '\n\n' : '') +
          `[Handoff] ${streamResult.handoff.summary}\n\nNext steps: ${streamResult.handoff.nextSteps}`;
        runTracker.markCompleted({
          text: handoffResponse.trim() || undefined,
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: 'handoff',
        });
        notifyRunStatus();
      } else {
        runTracker.markCompleted({
          ...(finalResponse ? { text: finalResponse } : {}),
          usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          finishReason: streamResult.finished ? 'completed' : 'completed',
        });
        notifyRunStatus();
      }
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        ...(finalResponse ? { text: finalResponse } : {}),
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (runTracker && runTracker.getRun().status === 'running') {
          runTracker.markCancelled();
          notifyRunStatus();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }

      const message = getErrorMessage(error);
      chatStreamingLogger.event({
        level: 'error',
        event: 'chat.stream',
        outcome: 'failed',
        message: 'Stream failed',
        error,
        data: {
          thread_id: options.threadId || null,
          provider_type: options.providerType,
          model: options.model,
          user_facing_error: message,
        },
      });
      if (runTracker && runTracker.getRun().status === 'running') {
        runTracker.markFailed({ message });
        notifyRunStatus();
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      companionService.endThinking(companionThinkingKey);
      deps.approvals.cleanupPendingSessionsForWebContents(senderId);
      steerQueues.delete(senderId);
      if (options.threadId) {
        untrackThreadStream(options.threadId, senderId);
      }
      if (deps.activeStreams.get(senderId) === streamState) {
        deps.activeStreams.delete(senderId);
      }
    }
  };

  return {
    getModels: streamingModels.getModels,
    getAcpAuthMethods: streamingModels.getAcpAuthMethods,
    isProviderConfigured: streamingModels.isProviderConfigured,
    send,
    stream,
    stopStream,
    steerStream,
  };
};

export type ChatStreaming = ReturnType<typeof createChatStreaming>;
