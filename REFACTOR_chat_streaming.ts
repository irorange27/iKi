/*
 * chat_streaming.ts — refactored with ToolLoopAgent (ai@6.0.3)
 *
 * Changes from original:
 *   - Replaced SimpleAgentRunner + manual generator iteration with ToolLoopAgent
 *   - Replaced manual retry/abort with built-in maxRetries/abortSignal
 *   - Replaced buildAiToolSet/collectToolCalls/collectApprovalRequests (ai_sdk_runtime.ts)
 *     with ToolLoopAgent-native tool handling
 *   - Kept: rate limiting, thread tracking, turnPreparer, companion, runTracker, uiEmitter,
 *     autonomous outer batching, steer, handoff chaining, approval recovery context
 *
 * Deleted files: simple_agent_runner.ts, simple_conversation_runner.ts,
 *                 ai_sdk_runtime.ts, chat_agent_runner.ts
 */
import {
  ToolLoopAgent,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
  type StreamTextResult,
} from 'ai';
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
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './chat_approval_types';
import {
  createApprovalRecoveryContext,
  describeApprovalRequiredTools,
} from './chat_approval_types';
import * as agentRunDb from '../../../core/db/agent_runs';
import { createAgentRunTracker } from './chat_run_tracking';
import { createChatStreamingModels } from './chat_streaming_models';
import { createChatTurnPreparer, type ChatTurnOptions } from './chat_turn_preparer';
import type { ActiveStreamState, ChatWebContents, RunStatusEvent } from './chat_types';
import type { ConversationPreview } from '../../../shared/types/companion';
import { createUiChunkEmitter } from './chat_ui';
import { companionService } from '../companion/companion_service';
import { createRateLimiter } from '../../../daemon/rate_limiter';
import { defaultToolRegistry } from '../../../core/tools';
import {
  composePrepareSteps,
  createPlanThenExecutePrepareStep,
} from '../../../core/agent';
import { createTodoPrepareStep } from './chat_todo_planning';

const logger = createLogger({ module: 'chat_streaming' });

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;
const MAX_OUTER_AUTONOMOUS_BATCHES = 50;
const MAX_HANDOFF_CHAIN = 5;

export type ChatSendResult =
  | { success: true; text: string; runId?: string }
  | { success: false; error: string; runId?: string };

// ── Helpers ─────────────────────────────────────────────────────────────

/** Extract a string arg from a tool call input (handles both object and unknown). */
function extractArg(input: unknown, key: string, fallback: string): string {
  if (typeof input === 'object' && input !== null) {
    const val = (input as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : fallback;
  }
  return fallback;
}

/** Extract handoff summary/nextSteps/reason from checkpoint messages. */
function extractHandoffContext(messages: ModelMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
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
        if (!args) continue;
        const summary = typeof args.summary === 'string' ? args.summary : '';
        const nextSteps = typeof args.next_steps === 'string' ? args.next_steps : '';
        const reason = typeof args.reason === 'string' ? args.reason : '';
        if (!summary && !nextSteps) continue;
        const parts: string[] = ['You are resuming work from a previous agent run.'];
        if (summary) parts.push(`\nSummary of previous work:\n${summary}`);
        if (nextSteps) parts.push(`\nNext steps to complete:\n${nextSteps}`);
        if (reason) parts.push(`\nReason for handoff: ${reason}`);
        parts.push('\nThe conversation history from the previous run is below. Continue the work based on what was done before.');
        return parts.join('');
      }
    }
  }
  return null;
}

// ── Agent factory (replaces createChatAgentRunner + buildAiToolSet) ──────

interface AgentRunContext {
  threadId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  availableSkillIds: string[];
  maxIterations: number;
  maxOutputTokens?: number;
}

function createAgent(ctx: AgentRunContext): ToolLoopAgent<never, ToolSet> {
  const tools: ToolSet = {};
  for (const toolName of ctx.enabledTools) {
    const tool = defaultToolRegistry.get(toolName);
    if (!tool) {
      logger.warn(`Tool ${toolName} not found in registry`);
      continue;
    }
    tools[toolName] = {
      description: tool.description,
      inputSchema: tool.paramSchema ?? (tool.parameters as Record<string, unknown>),
      needsApproval: tool.needsApproval,
      execute: async (input: unknown) => await tool.handler(input),
    };
  }

  const model = llmFactory.createModel(ctx.providerType, ctx.model, ctx.providerId);

  const prepareSteps: Array<NonNullable<Parameters<typeof ToolLoopAgent>[0]>['prepareStep']> = [];
  if (ctx.enabledTools.length > 0) {
    const planStep = createPlanThenExecutePrepareStep(ctx.enabledTools);
    if (planStep) prepareSteps.push(planStep);
    const todoStep = createTodoPrepareStep(ctx.enabledTools);
    if (todoStep) prepareSteps.push(todoStep);
  }

  return new ToolLoopAgent({
    model,
    instructions: ctx.systemPrompt,
    tools,
    stopWhen: stepCountIs(ctx.maxIterations),
    maxRetries: 3,
    ...(ctx.maxOutputTokens !== undefined ? { maxOutputTokens: ctx.maxOutputTokens } : {}),
    ...(prepareSteps.length > 0
      ? { prepareStep: prepareSteps.length === 1 ? prepareSteps[0] : composePrepareSteps(...prepareSteps) }
      : {}),
  });
}

// ── Public API ────────────────────────────────────────────────────────────

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

  // ── Rate limiting & thread tracking ──────────────────────────────────

  const checkThreadRunRate = (threadId: string) => {
    if (!threadId) return { allowed: true };
    return threadRunLimiter.check(threadId);
  };

  const cancelThreadStreams = (threadId: string, exceptSenderId?: number) => {
    const senderIds = threadStreams.get(threadId);
    if (!senderIds) return;
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
    const ids = threadStreams.get(threadId);
    if (ids) ids.add(senderId);
    else threadStreams.set(threadId, new Set([senderId]));
  };

  const untrackThreadStream = (threadId: string, senderId: number) => {
    const ids = threadStreams.get(threadId);
    if (!ids) return;
    ids.delete(senderId);
    if (ids.size === 0) threadStreams.delete(threadId);
  };

  // ── User controls ────────────────────────────────────────────────────

  const stopStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (!streamState) return { success: false, error: 'No active stream' };
    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    steerQueues.delete(senderId);
    return { success: true };
  };

  const steerStream = (senderId: number, message: string) => {
    const steerQueue = steerQueues.get(senderId);
    if (!steerQueue) return { success: false, error: 'No active autonomous stream to steer' };
    steerQueue.push(message);
    const streamState = deps.activeStreams.get(senderId);
    if (streamState && !streamState.cancelled) {
      streamState.steered = true;
      streamState.abortController.abort('steer');
    }
    return { success: true };
  };

  // ── Non-streaming send (uses ToolLoopAgent.generate) ─────────────────

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
      const systemPrompt = preparedTurn.enableTools ? TOOL_AGENT_SYSTEM_PROMPT : NO_TOOLS_SYSTEM_PROMPT;

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
          prompt: preparedTurn.prompt,
          messages: preparedTurn.finalMessages,
          metadata: {
            ...(options.runConfig?.metadata ?? {}),
            transport: 'send',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
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
        const agent = createAgent({
          threadId: options.threadId,
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt,
          enabledTools: preparedTurn.guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          maxIterations,
          maxOutputTokens: preparedTurn.maxOutputTokens,
        });

        if (!preparedTurn.prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        const result = await runWithToolRuntimeContext(
          { runId: runTracker.id, runTracker, threadId: options.threadId },
          () =>
            agent.generate({
              prompt: preparedTurn.prompt,
              messages: preparedTurn.history,
            })
        );

        // Check for handoff tool calls
        const toolCalls = await result.toolCalls;
        const hasHandoff = toolCalls.some(tc => tc.toolName === 'handoff');

        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          providerType: options.providerType,
          model: options.model,
          usage: await result.totalUsage,
          source: 'chat.send.tools',
          metadata: {
            contextTokens: preparedTurn.report.totalEstimatedTokens,
          },
        });

        // Check for approval requests in the response content
        const content = await result.content;
        const approvalRequests = content.filter(
          (c): c is Extract<typeof c, { type: 'tool-approval-request' }> =>
            c.type === 'tool-approval-request'
        );

        if (approvalRequests.length > 0) {
          const approvalError = describeApprovalRequiredTools(
            approvalRequests.map(req => ({
              approvalId: req.approvalId,
              toolCall: req.toolCall,
            }))
          );
          runTracker.markBlocked({
            text: await result.text,
            usage: await result.totalUsage,
            pendingApprovalIds: approvalRequests.map(r => r.approvalId),
          });
          throw new Error(approvalError);
        }

        const finishReason = await result.finishReason;
        runTracker.markCompleted({
          text: await result.text,
          usage: await result.totalUsage,
          finishReason: finishReason === 'tool-calls' && hasHandoff ? 'handoff' : 'completed',
        });

        return {
          success: true,
          text: await result.text,
          ...(options.runConfig?.kind ? { runId: runTracker.id } : {}),
        };
      }

      // No tools: direct LLM call
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
        metadata: { contextTokens: preparedTurn.report.totalEstimatedTokens },
      });

      runTracker.markCompleted({
        text: llmResult.text,
        usage: llmResult.usage,
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
      return { success: false, error: message };
    }
  };

  // ── Streaming (ToolLoopAgent.stream) ─────────────────────────────────

  const stream = async (webContents: ChatWebContents, options: ChatTurnOptions) => {
    const senderId = webContents.id;

    // Cancel any existing stream for this sender
    const existingStream = deps.activeStreams.get(senderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('superseded-by-new-request');
    }

    const uiEmitter = createUiChunkEmitter(webContents);

    // Rate limit check
    if (options.threadId) {
      const rateCheck = checkThreadRunRate(options.threadId);
      if (!rateCheck.allowed) {
        const delaySec = Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000);
        uiEmitter.error(`Too many requests on this thread. Retry in ${delaySec}s.`);
        return { success: false, error: `Too many requests on this thread. Retry in ${delaySec}s.` };
      }
    }

    // Thread stream tracking
    if (options.threadId) {
      cancelThreadStreams(options.threadId, senderId);
      trackThreadStream(options.threadId, senderId);
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const companionKey = `renderer:${senderId}:${Date.now().toString(36)}`;
    deps.activeStreams.set(senderId, streamState);
    const steerQueue: string[] = [];
    steerQueues.set(senderId, steerQueue);

    let runTracker: ReturnType<typeof createAgentRunTracker> | null = null;
    let turnHadToolCalls = false;
    let isAwaitingApproval = false;
    let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let previewText = '';
    let lastPreviewText = '';

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

    const sendPreview = (kind: ConversationPreview['kind'], text: string, toolName?: string) => {
      if (!options.threadId) return;
      companionService.setConversationPreview({
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
        sendPreview('responding', lastPreviewText);
      }, 300);
    };

    try {
      // ── Phase 1: Prepare turn ────────────────────────────────────────
      const preparedTurn = await turnPreparer.prepareChatTurn({
        ...options,
        onMemoryRetrieved: payload => uiEmitter.emitMemoryRetrieval(payload),
      });

      const maxIterations = resolveChatToolMaxIterations(options.maxIterations);
      const autonomousMode = options.autonomous && options.autonomous.maxIterations > 1;
      const guardedTools = preparedTurn.guardedTools;
      const systemPrompt = preparedTurn.enableTools ? TOOL_AGENT_SYSTEM_PROMPT : NO_TOOLS_SYSTEM_PROMPT;

      // Emit pre-turn signals
      if (preparedTurn.usedSkills.length > 0) {
        uiEmitter.emitSkillUsage({ mode: preparedTurn.skillMode, skills: preparedTurn.usedSkills });
      }
      if (preparedTurn.affectSignal) uiEmitter.emitAffectSignal(preparedTurn.affectSignal);

      companionService.setChatPolicy(preparedTurn.interventionPolicy);
      const affect = preparedTurn.affectSignal?.state;
      companionService.setAffect(
        affect && affect.valence !== undefined && affect.arousal !== undefined
          ? { label: affect.label, valence: affect.valence, arousal: affect.arousal }
          : null
      );

      // ── Phase 2: Setup state ─────────────────────────────────────────
      let currentHistory: ModelMessage[] = preparedTurn.history;
      let currentPrompt = preparedTurn.prompt;

      // Handle handoff-resume: extract handoff context from checkpoint
      if (options.runConfig?.kind === 'handoff-resume' && options.runConfig?.parentRunId) {
        const checkpoint = agentRunDb.getLatestAgentRunCheckpoint(options.runConfig.parentRunId);
        const checkpointMessages = checkpoint?.snapshot?.working?.modelMessages as ModelMessage[] | undefined;
        if (checkpointMessages?.length) {
          const handoffCtx = extractHandoffContext(checkpointMessages);
          if (handoffCtx) {
            currentHistory = [
              { role: 'system', content: `[HANDOFF CONTEXT] ${handoffCtx}` },
              ...checkpointMessages,
              ...(preparedTurn.history.length > 0
                ? [{ role: 'system' as const, content: '[CURRENT THREAD] Following messages are from the current conversation thread:' }, ...preparedTurn.history]
                : []),
            ];
            currentPrompt = preparedTurn.prompt || 'Continue the work from where the previous agent left off.';
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
          prompt: currentPrompt,
          messages: preparedTurn.finalMessages,
          metadata: {
            ...(options.runConfig?.metadata ?? {}),
            transport: 'stream',
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            skillMode: preparedTurn.skillMode,
            maxIterations,
            enableTools: preparedTurn.enableTools,
            assistantMessageId: uiEmitter.messageId,
          },
        },
        working: {
          modelMessages: currentHistory,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      });
      streamState.runId = runTracker.id;

      sendPreview('thinking', '');
      companionService.beginThinking(companionKey);

      // ── Phase 3: Autonomous outer loop ───────────────────────────────
      // ToolLoopAgent handles the inner tool loop, retry, cancel, and approval.
      // We handle autonomous batching and handoff chaining as thin wrappers.

      let outerBatch = 0;
      let handoffChain = 0;
      let accumulatedResponse = '';
      let finalStreamResult: {
        awaitingApproval: boolean;
        cancelled?: boolean;
        finished?: boolean;
        response?: string;
        usage?: import('ai').LanguageModelUsage;
        handoff?: { summary: string; nextSteps: string; reason: string };
        modelMessages?: ModelMessage[];
      } | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
          // ToolLoopAgent handles both tool-enabled and no-tools paths.
        // When no tools, the agent has an empty ToolSet and generates text directly.
        const agent = createAgent({
          threadId: options.threadId,
          providerType: options.providerType,
          providerId: options.providerId,
          model: options.model,
          systemPrompt,
          enabledTools: guardedTools,
          availableSkillIds: preparedTurn.selectedSkillIds,
          maxIterations,
          maxOutputTokens: preparedTurn.maxOutputTokens,
        });

        let cancelled = false;
        let steered = false;
        let streamResult: StreamTextResult<ToolSet> | undefined;

        try {
          streamResult = agent.stream({
            prompt: currentPrompt,
            messages: currentHistory,
            abortSignal: streamState.abortController.signal,
          });

          for await (const part of streamResult.fullStream) {
            // Steer / cancel check (between ToolLoopAgent steps)
            if (streamState.cancelled) { cancelled = true; break; }
            if (streamState.steered) { steered = true; break; }

            switch (part.type) {
              case 'text-start':
                // AI SDK emits this before text. Our uiEmitter handles start internally.
                break;
              case 'text-delta':
                uiEmitter.emitTextDelta(part.text);
                previewText += part.text;
                debouncedTextPreview(previewText);
                break;
              case 'text-end':
                // Unused by our uiEmitter (it handles text boundary internally).
                break;
              case 'tool-call':
                turnHadToolCalls = true;
                sendPreview('tool', previewText || ' ', part.toolName);
                uiEmitter.emitToolEvent({
                  type: 'tool-call',
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input as Record<string, unknown>,
                });
                break;
              case 'tool-result':
                uiEmitter.emitToolEvent({
                  type: 'tool-result',
                  toolCallId: part.toolCallId,
                  output: part.output,
                });
                break;
              case 'tool-error':
                uiEmitter.emitToolEvent({
                  type: 'tool-error',
                  toolCallId: part.toolCallId,
                  error:
                    typeof part.error === 'string'
                      ? part.error
                      : part.error instanceof Error
                        ? part.error.message
                        : 'Tool execution failed',
                });
                break;
              case 'tool-approval-request':
                // ToolLoopAgent pauses here. Register approval session for recovery.
                if (part.approvalId) {
                  deps.approvals.ensurePendingApprovalSession(part.approvalId, {
                    webContents,
                    history: currentHistory,
                  });
                  uiEmitter.emitToolEvent({
                    type: 'tool-approval-request',
                    approvalId: part.approvalId,
                    toolCallId: part.toolCall.toolCallId || '',
                    toolCall: {
                      toolName: part.toolCall.toolName,
                      toolCallId: part.toolCall.toolCallId || '',
                      args: (part.toolCall.input as Record<string, unknown>) ?? {},
                    },
                  });
                }
                break;
              case 'tool-output-denied':
                // Approval was denied — UI handles this.
                break;
              case 'start-step':
                // Step boundary — useful for run tracking.
                runTracker?.recordToolEvent({
                  type: 'tool-call',
                  toolCallId: `step-${runTracker?.getRun()?.id ?? '0'}`,
                  toolName: 'step-start',
                  input: { stepWarnings: part.warnings },
                });
                break;
              case 'finish-step':
                break;
              case 'start':
              case 'finish':
              case 'abort':
              case 'error':
              case 'raw':
                // Stream lifecycle events.
                break;
              case 'reasoning-start':
              case 'reasoning-end':
              case 'reasoning-delta':
              case 'source':
              case 'file':
                // Not used by our UI emitter.
                break;
              default:
                // Exhaustive check — log unexpected types.
                break;
            }
          }

          if (steered) {
            streamState.steered = false;
            // Drain steer queue, inject messages, restart loop
            const msgs = steerQueue.splice(0);
            if (msgs.length > 0) {
              currentHistory = [
                ...currentHistory,
                { role: 'user' as const, content: `[STEER] ${msgs.join('\n\n---\n\n')}` },
              ];
            }
            currentPrompt = options.autonomous?.continuePrompt || 'Continue.';
            continue;
          }

          // Collect final results from the completed stream
          const [text, toolCalls, totalUsage, finishReason, response] = await Promise.all([
            streamResult.text,
            streamResult.toolCalls,
            streamResult.totalUsage,
            streamResult.finishReason,
            streamResult.response,
          ]);

          const handoffCall = toolCalls.find(tc => tc.toolName === 'handoff');
          const hadApprovalRequests = finishReason === 'tool-calls' &&
            toolCalls.every(tc => !('execute' in (tc as Record<string, unknown>)));

          finalStreamResult = {
            awaitingApproval: hadApprovalRequests,
            cancelled,
            finished: !!handoffCall,
            response: text,
            usage: totalUsage,
            modelMessages: response.messages as ModelMessage[],
            handoff: handoffCall
              ? {
                  summary: extractArg(handoffCall.input, 'summary', ''),
                  nextSteps: extractArg(handoffCall.input, 'next_steps', ''),
                  reason: extractArg(handoffCall.input, 'reason', 'other'),
                }
              : undefined,
          };

          if (finalStreamResult.response) {
            accumulatedResponse = accumulatedResponse
              ? accumulatedResponse + '\n\n' + finalStreamResult.response
              : finalStreamResult.response;
          }
          if (accumulatedResponse) sendPreview('responding', accumulatedResponse);
          previewText = '';

          if (finalStreamResult.modelMessages?.length) {
            runTracker.syncModelMessages(finalStreamResult.modelMessages);
          }

          if (cancelled || finalStreamResult.awaitingApproval) break;
          if (finalStreamResult.finished || !autonomousMode) break;

          // Autonomous: continue to next batch
          outerBatch++;
          if (outerBatch >= MAX_OUTER_AUTONOMOUS_BATCHES) break;
          if (outerBatch % 5 === 0) runTracker.createCheckpoint('periodic');

          currentHistory = finalStreamResult.modelMessages ?? currentHistory;
          currentPrompt = options.autonomous?.continuePrompt || 'Continue with the next step.';

        } catch (error) {
          if (streamState.cancelled || (error instanceof Error && error.name === 'AbortError')) {
            cancelled = true;
          } else {
            throw error;
          }
        }

        if (cancelled) {
          finalStreamResult = { awaitingApproval: false, cancelled: true };
          break;
        }

        // Handoff chaining
        if (finalStreamResult?.handoff && !finalStreamResult?.cancelled) {
          handoffChain++;
          if (handoffChain >= MAX_HANDOFF_CHAIN || !autonomousMode) break;

          accumulatedResponse = accumulatedResponse
            ? accumulatedResponse + '\n\n[Handoff]\n' + finalStreamResult.handoff.summary
            : finalStreamResult.handoff.summary;

          runTracker.markCompleted({
            text: accumulatedResponse,
            usage: finalStreamResult.usage,
            finishReason: 'handoff',
          });
          notifyRunStatus();

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
              prompt: finalStreamResult.handoff.nextSteps || finalStreamResult.handoff.summary,
              messages: [],
              metadata: { source: 'handoff', parentRunId, handoffChain },
            },
            working: {
              modelMessages: [],
              accumulatedText: '',
              pendingApprovalIds: [],
              lastStepIndex: 0,
            },
          });
          streamState.runId = runTracker.id;

          currentHistory = [
            {
              role: 'system',
              content: [
                '[HANDOFF CONTEXT] You are a fresh agent instance continuing work handed off from a previous agent.',
                `Summary of completed work:\n${finalStreamResult.handoff.summary}`,
                `Next steps to complete:\n${finalStreamResult.handoff.nextSteps}`,
                `Reason for handoff: ${finalStreamResult.handoff.reason}`,
                'You have a clean context window. Start working on the next steps immediately.',
              ].join('\n'),
            },
          ];
          currentPrompt = finalStreamResult.handoff.nextSteps || 'Continue the work from the handoff summary.';
          continue;
        }

        if (!finalStreamResult?.handoff) break;
      }

      // ── Phase 4: Finalize ────────────────────────────────────────────
      if (!finalStreamResult) throw new Error('Stream loop produced no result');

      const finalResponse = accumulatedResponse || finalStreamResult.response || '';

      if (!finalStreamResult.cancelled) {
        deps.usage.recordUsageEvent({
          threadId: options.threadId,
          messageId: uiEmitter.messageId,
          providerType: options.providerType,
          model: options.model,
          usage: finalStreamResult.usage,
          source: 'chat.stream',
          metadata: {
            awaitingApproval: finalStreamResult.awaitingApproval,
            contextTokens: preparedTurn.report.totalEstimatedTokens,
            ...(outerBatch > 0 ? { autonomousBatches: outerBatch + 1 } : {}),
          },
        });
      }

      if (finalStreamResult.cancelled) {
        runTracker.markCancelled({ text: finalResponse });
      } else if (finalStreamResult.awaitingApproval) {
        isAwaitingApproval = true;
        const pendingIds = (() => {
          try {
            const run = runTracker.getRun();
            return (run as Record<string, unknown>)?.pendingApprovalIds as string[] | undefined ?? [];
          } catch { return []; }
        })();
        runTracker.markBlocked({
          text: finalResponse,
          usage: finalStreamResult.usage,
          pendingApprovalIds: pendingIds,
        });
      } else {
        runTracker.markCompleted({
          text: finalResponse,
          usage: finalStreamResult.usage,
          finishReason: finalStreamResult.handoff ? 'handoff' : 'completed',
        });
      }
      notifyRunStatus();

      if (!finalStreamResult.awaitingApproval) uiEmitter.finish();

      return {
        success: true,
        awaitingApproval: finalStreamResult.awaitingApproval,
        text: finalResponse,
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        uiEmitter.abort();
        if (runTracker && runTracker.getRun().status === 'running') {
          runTracker.markCancelled();
          notifyRunStatus();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }

      const message = getErrorMessage(error);
      logger.event({
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
      uiEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      companionService.clearConversationPreview();
      companionService.endThinking(companionKey);
      if (turnHadToolCalls && !streamState.cancelled) {
        companionService.notifyReplyComplete(
          options.threadId ? deps.getThreadTitle?.(options.threadId) : undefined
        );
      }
      if (!isAwaitingApproval) deps.approvals.cleanupPendingSessionsForWebContents(senderId);
      steerQueues.delete(senderId);
      if (options.threadId) untrackThreadStream(options.threadId, senderId);
      if (deps.activeStreams.get(senderId) === streamState) deps.activeStreams.delete(senderId);
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
