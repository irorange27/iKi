import type { AgentStep } from '@iki/core/agent';
import { createLogger } from '@iki/core/logger';
import { runWithToolRuntimeContext } from '../tools/runtime_context';
import { getErrorMessage } from '@iki/core/utils/errors';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveChatToolMaxIterations,
} from './constants';
import type { ChatMemory } from './memory';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import { createApprovalRecoveryContext } from './approval_types';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createAgentRunTracker } from '../agent/run_tracker';
import { AgentHarness } from '../agent/harness';
import type { TurnOutput } from '../agent/harness/harness_types';
import { createChatStreamingModels } from './models';
import { createChatTurnPreparer, type ChatTurnOptions } from './turn_preparer';
import { createChatSend } from './chat_send';
export type { ChatSendResult } from './chat_send';
import type { ActiveStreamState, ChatWebContents, RunStatusEvent, ToolStreamEvent } from './types';
import type { ConversationPreview } from '@iki/backend/types/companion';
import { createUiChunkEmitter } from './ui_stream';
import { getCompanion } from './platform';
import { createRateLimiter } from '@iki/core/rate_limiter';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;

export const createChatStreaming = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
  memory: ChatMemory;
  getThreadTitle?: (threadId: string) => string | undefined;
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
        webContents: ChatWebContents;
        history?: import('ai').ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
    cleanupPendingSessionsForWebContents: (senderId: number) => void;
  };
}) => {
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

  const { send } = createChatSend({
    turnPreparer,
    usage: deps.usage,
    checkThreadRunRate,
  });

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
    let turnHadToolCalls = false;

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

    let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let isAwaitingApproval = false;

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
      const guardedTools = preparedTurn.guardedTools;

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

      getCompanion().setChatPolicy(preparedTurn.interventionPolicy);
      const affectState = preparedTurn.affectSignal?.state;
      if (affectState && affectState.valence !== undefined && affectState.arousal !== undefined) {
        getCompanion().setAffect({
          label: affectState.label,
          valence: affectState.valence,
          arousal: affectState.arousal,
        });
      } else {
        getCompanion().setAffect(null);
      }

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

      let harness = new AgentHarness({
        providerType: options.providerType,
        providerId: options.providerId,
        model: options.model,
        systemPrompt,
        enableTools: preparedTurn.enableTools,
        enabledToolNames: guardedTools,
        availableSkillIds: preparedTurn.selectedSkillIds,
        guardActive: preparedTurn.guardActive,
        requireApproval: preparedTurn.requireApproval,
        autoApproveToolRequests: preparedTurn.autoApproveToolRequests,
        maxIterations,
        ...(typeof preparedTurn.maxOutputTokens === 'number'
          ? { maxOutputTokens: preparedTurn.maxOutputTokens }
          : {}),
      });

      if (!preparedTurn.prompt.trim()) {
        throw new Error('No user prompt provided for streaming');
      }

      getCompanion().beginThinking(companionThinkingKey);

      const MAX_OUTER_AUTONOMOUS_BATCHES = 50;
      const MAX_HANDOFF_CHAIN = 5;
      let outerBatch = 0;
      let handoffChain = 0;
      type StreamResult = {
        awaitingApproval: boolean;
        cancelled?: boolean;
        finished?: boolean;
        partialFailure?: boolean;
        response?: string;
        usage?: import('@iki/core/agent').AgentResult['usage'];
        handoff?: { summary: string; nextSteps: string; reason: string };
      };
      let streamResult: StreamResult | undefined;
      let accumulatedResponse = '';
      let previewText = '';
      let lastPreviewText = '';

      const sendConversationPreview = (kind: ConversationPreview['kind'], text: string, toolName?: string) => {
        if (!options.threadId) return;
        getCompanion().setConversationPreview({
          threadId: options.threadId,
          kind,
          text: text.slice(-200),
          ...(toolName ? { toolName } : {}),
        });
      };

      const debouncedTextPreview = (text: string) => {
        lastPreviewText = text;
        if (previewDebounceTimer) return;
        previewDebounceTimer = setTimeout(() => {
          previewDebounceTimer = null;
          sendConversationPreview('responding', lastPreviewText);
        }, 300);
      };

      sendConversationPreview('thinking', '');

      /** Convert AgentStep to ToolStreamEvent for runTracker + UI emitter. */
      const forwardAgentStep = (step: AgentStep) => {
        // Emit text deltas via the dedicated ui chunk emitter path
        if (step.type === 'message_update') {
          uiChunkEmitter.emitTextDelta(step.text);
          if (step.kind === 'text') {
            previewText = previewText + step.text;
            debouncedTextPreview(previewText);
          }
          return;
        }

        // Convert AgentStep → ToolStreamEvent-like shape for runTracker and UI
        let event: ToolStreamEvent | null = null;

        if (step.type === 'tool_execution_start') {
          turnHadToolCalls = true;
          sendConversationPreview('tool', previewText || ' ', step.toolName);
          event = {
            type: 'tool-call',
            toolCallId: step.toolCallId,
            toolName: step.toolName,
            input: step.input,
          };
        } else if (step.type === 'tool_input_end') {
          event = { type: 'tool-input-end', toolCallId: step.toolCallId };
        } else if (step.type === 'tool_execution_end') {
          if (step.outcome === 'success') {
            event = {
              type: 'tool-result',
              toolCallId: step.toolCallId,
              output: step.output,
            };
          } else {
            event = {
              type: 'tool-error',
              toolCallId: step.toolCallId,
              error: step.error ?? 'Tool execution failed',
            };
          }
        } else if (step.type === 'approval_request') {
          for (const req of step.requests) {
            if (req.approvalId) {
              deps.approvals.ensurePendingApprovalSession(req.approvalId, {
                webContents,
                history: harness.getHistory() ?? streamHistory,
                recoveryContext: approvalContext,
              });
            }
          }
          for (const req of step.requests) {
            if (req.approvalId) {
              uiChunkEmitter.emitToolEvent({
                type: 'tool-approval-request',
                approvalId: req.approvalId,
                toolCallId: req.toolCallId || '',
                ...(req.toolCall
                  ? {
                      toolCall: {
                        toolName: req.toolCall.toolName,
                        toolCallId: req.toolCallId || '',
                        args: req.toolCall.args ?? {},
                      },
                    }
                  : {}),
              });
            }
          }
          return;
        } else if (step.type === 'handoff') {
          event = {
            type: 'tool-call',
            toolCallId: `handoff-${outerBatch}`,
            toolName: 'handoff',
            input: {
              summary: step.summary,
              nextSteps: step.nextSteps,
              reason: step.reason,
            },
          };
        } else if (step.type === 'source') {
          event = {
            type: 'tool-call',
            toolCallId: step.sourceId,
            toolName: 'source',
            input: {
              sourceId: step.sourceId,
              ...(step.title ? { title: step.title } : {}),
              ...(step.url ? { url: step.url } : {}),
            },
          };
        }

        if (event) {
          if (event.type !== 'tool-input-end') {
            runTracker?.recordToolEvent(event);
          }
          uiChunkEmitter.emitToolEvent(event);
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Run agent via harness — for-await consumes TurnEvent stream
        let agentResult: import('@iki/core/agent').AgentResult | undefined;
        let cancelled = false;
        let steered = false;
        let awaitingApproval = false;

        try {
          agentResult = await runWithToolRuntimeContext(
            { runId: runTracker.id, runTracker, threadId: options.threadId },
            async () => {
              for await (const event of harness.turn({
                prompt: streamPrompt,
                history: streamHistory,
                runTracker,
                abortSignal: streamState.abortController.signal,
              })) {
                if (event.event === 'step') {
                  forwardAgentStep(event.step);
                  continue;
                }

                if (event.event === 'done') {
                  const output = event.output;
                  return {
                    response: output.text,
                    toolCalls: output.toolCalls,
                    toolApprovalRequests: output.toolApprovalRequests,
                    usage: output.usage,
                    iterations: 0,
                    requiresApproval: output.requiresApproval,
                  } as import('@iki/core/agent').AgentResult;
                }
              }
              return undefined;
            }
          );
        } catch (error) {
          if (
            (streamState.steered ?? false) ||
            streamState.cancelled ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            if ((streamState.steered ?? false) && !streamState.cancelled) {
              steered = true;
            } else {
              cancelled = true;
            }
          } else {
            throw error;
          }
        }

        if (steered) {
          streamState.steered = false;
          streamHistory = harness.getHistory();
          if (steerQueue.length > 0) {
            const drained: string[] = [];
            while (steerQueue.length > 0) {
              const msg = steerQueue.shift();
              if (msg !== undefined) drained.push(msg);
            }
            if (drained.length > 0) {
              const steerPrompt =
                drained.length === 1
                  ? drained[0]
                  : drained.join('\n\n---\n\n');
              streamHistory = [
                ...streamHistory,
                { role: 'user' as const, content: `[STEERING INPUT]\n\n${steerPrompt}` },
              ];
            }
          }
          streamState.abortController = new AbortController();
          continue;
        }

        if (cancelled) {
          streamResult = { awaitingApproval: false, cancelled: true };
          break;
        }

        // Check for approval requests in result
        if (agentResult?.requiresApproval && agentResult.toolApprovalRequests?.length) {
          deps.approvals.registerApprovalBatch(agentResult.toolApprovalRequests, {
            webContents,
            history: harness.getHistory() ?? streamHistory,
            ...(approvalContext ? { recoveryContext: approvalContext } : {}),
          });
          streamResult = {
            awaitingApproval: true,
            response: agentResult.response,
            usage: agentResult.usage,
          };
          isAwaitingApproval = true;
          break;
        }

        // Build stream result from agent result
        const handoff = agentResult?.toolCalls?.find(
          tc => tc.toolName === 'handoff'
        );
        const terminalToolName = handoff ? 'handoff' : undefined;

        streamResult = {
          awaitingApproval: false,
          ...(agentResult?.response?.trim()
            ? { response: agentResult.response }
            : {}),
          usage: agentResult?.usage,
          ...(terminalToolName === 'handoff' && handoff
            ? {
                handoff: {
                  summary:
                    typeof (handoff.args as Record<string, unknown>)?.summary === 'string'
                      ? (handoff.args as Record<string, unknown>).summary as string
                      : '',
                  nextSteps:
                    typeof (handoff.args as Record<string, unknown>)?.next_steps === 'string'
                      ? (handoff.args as Record<string, unknown>).next_steps as string
                      : '',
                  reason:
                    typeof (handoff.args as Record<string, unknown>)?.reason === 'string'
                      ? (handoff.args as Record<string, unknown>).reason as string
                      : 'other',
                },
              }
            : {}),
          ...(terminalToolName ? { finished: true } : {}),
        };

        if (streamResult.response) {
          accumulatedResponse = accumulatedResponse
            ? accumulatedResponse + '\n\n' + streamResult.response
            : streamResult.response;
        }

        if (accumulatedResponse) {
          sendConversationPreview('responding', accumulatedResponse);
        }
        previewText = '';

        runTracker.syncModelMessages(harness.getHistory() ?? streamHistory);

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

          harness = new AgentHarness({
            providerType: options.providerType,
            providerId: options.providerId,
            model: options.model,
            systemPrompt,
            enableTools: preparedTurn.enableTools,
            enabledToolNames: guardedTools,
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

        streamHistory = harness.getHistory() ?? streamHistory;
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
      if (!streamResult.awaitingApproval) {
        uiChunkEmitter.finish();
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
      if (previewDebounceTimer) {
        clearTimeout(previewDebounceTimer);
        previewDebounceTimer = null;
      }
      getCompanion().clearConversationPreview();
      getCompanion().endThinking(companionThinkingKey);
      if (turnHadToolCalls && !streamState.cancelled) {
        const threadLabel =
          options.threadId ? deps.getThreadTitle?.(options.threadId) : undefined;
        getCompanion().notifyReplyComplete(threadLabel);
      }
      if (!isAwaitingApproval) {
        deps.approvals.cleanupPendingSessionsForWebContents(senderId);
      }
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
