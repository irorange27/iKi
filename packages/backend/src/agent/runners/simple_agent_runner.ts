import {
  smoothStream,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';

import { createLogger } from '@iki/backend/logger';
import { langfuseTelemetry } from '@iki/backend/observability/langfuse';
import {
  RefusalError,
  getErrorMessage,
  isRetryableError,
} from '@iki/backend/utils/errors';
import {
  createModel,
  disposeLanguageModel,
  getModelGenerationSettings,
  injectReasoningContentIntoMessages,
} from '../../provider/llm/factory';
import { normalizeLanguageModelUsage } from '../../provider/llm/usage';
import { parseToolInputFromText } from '@iki/backend/message/tool_parts';
import {
  appendResponseMessages,
  appendUserPromptToHistory,
  buildAiToolSet,
  buildPromptContext,
  cloneModelMessages,
  collectApprovalRequests,
  collectToolCalls,
  normalizeCollectedToolCall,
} from '../../provider/ai_sdk_runtime';
import {
  loadAgentConfig,
  validateAgentConfig,
} from '../ai_sdk_config';
import { addTurnPerf } from '../types';
import type {
  AgentStep,
  MessageUpdateStep,
  ToolExecutionStartStep,
  ToolExecutionEndStep,
  ApprovalRequestStep,
  HandoffStep,
  TurnEndStep,
  SourceInfo,
} from '@iki/backend/agent/agent_step';
import type {
  AgentResult,
  AgentTool,
  AgentTurnPerf,
  AgentUsage,
  PartialAgentConfig,
} from '@iki/backend/agent/types';

const logger = createLogger({ module: 'simple_agent_runner' });

const ANTHROPIC_CACHE_PROVIDER_TYPES = new Set(['anthropic', 'anthropic-compatible']);

/**
 * Anthropic prompt caching: mark the last message as an ephemeral cache
 * breakpoint so the system prompt, tool definitions and the growing history
 * prefix are cache-served on subsequent steps/batches instead of being
 * re-billed as fresh input tokens (SWE-agent's CacheControl equivalent).
 * The caller's history array is never mutated.
 */
const withCacheBreakpoint = (providerType: string, messages: ModelMessage[]): ModelMessage[] => {
  if (!ANTHROPIC_CACHE_PROVIDER_TYPES.has(providerType) || messages.length === 0) {
    return messages;
  }

  const last = messages[messages.length - 1]!;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      providerOptions: {
        ...((last as ModelMessage & { providerOptions?: Record<string, unknown> }).providerOptions ??
          {}),
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    } as ModelMessage,
  ];
};

const TERMINAL_TOOL_NAMES = new Set(['handoff']);

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  estimatedCostUsd: 0,
};

const addUsage = (a: AgentUsage, b: AgentUsage | undefined): AgentUsage => {
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    estimatedCostUsd: (a.estimatedCostUsd ?? 0) + (b.estimatedCostUsd ?? 0),
  };
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));


/**
 * Configuration passed to the runner when starting a run.
 */
export interface AgentRunnerRequest {
  prompt: string;
  history?: ModelMessage[];
  tools: AgentTool[];

  /** Provider / model selection. */
  providerType: string;
  providerId?: string;
  model: string;

  /** Optional LLM knobs. */
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Reasoning-effort override (e.g. 'low' | 'medium' | 'high') merged into providerOptions. */
  reasoningEffort?: string;

  /** Maximum tool-calling iterations before forced stop. */
  maxIterations?: number;

  /** Signal to cancel the run externally. */
  abortSignal?: AbortSignal;

  /** Optional thread / session identifier — forwarded to Langfuse as sessionId. */
  threadId?: string;

  /** Additional free-form config overrides. */
  config?: PartialAgentConfig;
}

export class SimpleAgentRunner {
  private readonly modelFactory?: (
    providerType: string,
    modelId: string,
    providerId: string,
  ) => LanguageModel;
  private abortController: AbortController | null = null;
  private cancelRequested = false;
  private history: ModelMessage[] = [];

  constructor(
    config?: PartialAgentConfig & {
        modelFactory?: (
        providerType: string,
        modelId: string,
        providerId: string,
      ) => LanguageModel;
    },
  ) {
    this.modelFactory = config?.modelFactory;
  }

  cancel(): void {
    this.cancelRequested = true;
    this.abortController?.abort('user-cancel');
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }

  async *run(request: AgentRunnerRequest): AsyncGenerator<AgentStep, AgentResult> {
    this.abortController = new AbortController();
    this.cancelRequested = false;

    // streamText only sees the internal controller, so without this wiring
    // a caller's stop/supersede/steer abort would never reach the model call.
    const externalAbort = request.abortSignal;
    if (externalAbort) {
      if (externalAbort.aborted) {
        this.abortController.abort();
      } else {
        externalAbort.addEventListener(
          'abort',
          () => this.abortController.abort(),
          { once: true },
        );
      }
    }

    const config = loadAgentConfig({
      ...(request.config ?? {}),
      providerType: request.providerType,
      providerId: request.providerId,
      model: request.model,
      ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    });

    validateAgentConfig(config);

    const maxIterations = request.maxIterations ?? config.maxIterations;
    const retryMaxAttempts = 3;
    const retryBaseDelayMs = 1000;
    const retryMaxDelayMs = 30000;

    this.history = this.buildTurnHistory(request.history, request.prompt);
    let history = this.history;
    let cumulativeUsage: AgentUsage = { ...EMPTY_USAGE };
    let cumulativePerf: AgentTurnPerf | undefined;
    let allText = '';
    let totalSteps = 0;

    // Outer retry loop
    let retryAttempt = 0;

    while (retryAttempt <= retryMaxAttempts) {
      if (this.cancelRequested) {
        throw new Error('Run cancelled');
      }

      const usingCustomModel = Boolean(this.modelFactory);
      const model = usingCustomModel
        ? this.modelFactory!(config.providerType, config.model, config.providerId)
        : createModel(config.providerType, config.model, config.providerId);
      const tools = this.buildToolSet(config, request.tools);
      const promptContext = usingCustomModel
        ? { systemPrompt: config.systemPrompt, messages: history }
        : buildPromptContext(config, history);
      const messages = withCacheBreakpoint(config.providerType, promptContext.messages);
      const { systemPrompt } = promptContext;

      try {
        const telemetry = langfuseTelemetry('agent.stream', {
          sessionId: request.threadId,
          provider: config.providerType,
          providerId: config.providerId,
          model: config.model,
        });
        const result = streamText({
          model,
          system: systemPrompt,
          messages: injectReasoningContentIntoMessages(messages),
          tools,
          ...getModelGenerationSettings({
            providerType: config.providerType,
            modelId: config.model,
            providerId: config.providerId,
            temperature: config.temperature,
            reasoningEffort: request.reasoningEffort,
          }),
          maxOutputTokens: config.maxTokens,
          stopWhen: stepCountIs(
            config.enableTools ? Math.max(1, maxIterations - totalSteps) : 1
          ),
          abortSignal: this.abortController?.signal,
          experimental_transform: smoothStream(),
          ...(telemetry ? { experimental_telemetry: telemetry } : {}),
          onAbort: () => {
            logger.event({
              level: 'info',
              event: 'agent.stream.abort',
              outcome: 'cancelled',
              data: { provider: config.providerType, model: config.model },
            });
          },
        });

        let streamedText = '';
        let terminalToolName: string | null = null;
        // Collect approval requests from fullStream — AI SDK v6 emits
        // tool-approval-request parts inline when needsApproval is set on a tool.
        const streamApprovalRequests: Array<{
          approvalId: string;
          toolCallId?: string;
          toolCall?: { toolName: string; toolCallId?: string; input?: unknown; args?: unknown };
        }> = [];
        const collectedSources: SourceInfo[] = [];
        const pendingToolStarts = new Map<
          string,
          { toolName: string; input: Record<string, unknown>; inputText?: string }
        >();
        // Call ids whose tool_execution_start has already been yielded — the
        // start must fire exactly once regardless of which part completes it.
        const startedExecutions = new Set<string>();

        // Perf instrumentation: wall-clock around the stream consumption.
        // llmMs is derived as (total − tool) so provider streaming time and
        // inter-step overhead both count as model time, not tool time.
        const attemptStartedAt = Date.now();
        let stepStartedAt: number | null = null;
        let firstDeltaAt: number | null = null;
        const attemptFirstTokenSamples: number[] = [];
        const attemptToolStarts = new Map<string, number>();
        let attemptToolMs = 0;
        let attemptToolCalls = 0;
        const closeToolTiming = (toolCallId: string) => {
          const startedAt = attemptToolStarts.get(toolCallId);
          if (startedAt === undefined) return;
          attemptToolMs += Math.max(0, Date.now() - startedAt);
          attemptToolStarts.delete(toolCallId);
        };

        for await (const part of result.fullStream) {
          if (this.cancelRequested) {
            break;
          }

          if (part.type === 'text-delta' && part.text) {
            if (stepStartedAt !== null && firstDeltaAt === null) {
              firstDeltaAt = Date.now() - stepStartedAt;
              attemptFirstTokenSamples.push(firstDeltaAt);
            }
            streamedText += part.text;
            yield { type: 'message_update', text: part.text, kind: 'text' } satisfies MessageUpdateStep;
            continue;
          }

          if (part.type === 'tool-call') {
            const toolName =
              typeof part.toolName === 'string' ? part.toolName : '';
            if (toolName && TERMINAL_TOOL_NAMES.has(toolName)) {
              terminalToolName = toolName;
            }
            pendingToolStarts.set(part.toolCallId, {
              toolName,
              input: (part.input ?? {}) as Record<string, unknown>,
            });
            // Providers that stream tool input emit tool-input-end BEFORE the
            // final tool-call part; providers that deliver the call in one
            // chunk never emit tool-input-end at all. Emitting the execution
            // start here (guarded so it fires exactly once per call) keeps
            // toolName/input reaching the UI stream in both orders.
            if (
              toolName &&
              !TERMINAL_TOOL_NAMES.has(toolName) &&
              !startedExecutions.has(part.toolCallId)
            ) {
              startedExecutions.add(part.toolCallId);
              attemptToolStarts.set(part.toolCallId, Date.now());
              attemptToolCalls += 1;
              yield {
                type: 'tool_execution_start',
                toolCallId: part.toolCallId,
                toolName,
                input: (part.input ?? {}) as Record<string, unknown>,
              } satisfies ToolExecutionStartStep;
            }
            continue;
          }

          if (part.type === 'tool-approval-request') {
            const approvalPart = part as {
              approvalId: string;
              toolCallId?: string;
              toolCall?: { toolName: string; toolCallId?: string; input?: unknown; args?: unknown };
            };
            streamApprovalRequests.push({
              approvalId: approvalPart.approvalId,
              toolCallId: approvalPart.toolCallId ?? approvalPart.toolCall?.toolCallId,
              toolCall: approvalPart.toolCall
                ? {
                    toolName: approvalPart.toolCall.toolName,
                    toolCallId: approvalPart.toolCall.toolCallId,
                    input: approvalPart.toolCall.input,
                    args: approvalPart.toolCall.args,
                  }
                : undefined,
            });
            continue;
          }

          if (part.type === 'tool-output-denied') {
            closeToolTiming((part as { toolCallId: string }).toolCallId);
            yield {
              type: 'tool_execution_end',
              toolCallId: (part as { toolCallId: string }).toolCallId,
              outcome: 'error',
              error: 'Tool execution was denied',
            } satisfies ToolExecutionEndStep;
            continue;
          }

          if (part.type === 'tool-input-start') {
            // Some providers finish a tool call without a preceding tool-call
            // part; remember the name as soon as it appears so the execution
            // start (emitted at tool-input-end or tool-call) carries it.
            if (part.id && typeof part.toolName === 'string' && part.toolName) {
              if (!pendingToolStarts.has(part.id)) {
                pendingToolStarts.set(part.id, { toolName: part.toolName, input: {} });
              }
            }
            continue;
          }

          if (part.type === 'tool-input-delta') {
            // Reassemble streamed input so the execution start can carry the
            // full args even when tool-call has not arrived yet.
            if (part.id) {
              const pending = pendingToolStarts.get(part.id);
              if (pending) {
                pending.inputText = (pending.inputText ?? '') + String(part.delta ?? '');
                pending.input = (parseToolInputFromText(pending.inputText) ??
                  {}) as Record<string, unknown>;
              }
            }
            continue;
          }

          if (part.type === 'tool-input-end') {
            if (part.id) {
              const pending = pendingToolStarts.get(part.id);
              if (pending && !startedExecutions.has(part.id)) {
                startedExecutions.add(part.id);
                attemptToolStarts.set(part.id, Date.now());
                attemptToolCalls += 1;
                yield {
                  type: 'tool_execution_start',
                  toolCallId: part.id,
                  toolName: pending.toolName,
                  input: pending.input,
                } satisfies ToolExecutionStartStep;
              }
              pendingToolStarts.delete(part.id);
            }
            continue;
          }

          if (part.type === 'tool-result') {
            closeToolTiming(part.toolCallId);
            yield {
              type: 'tool_execution_end',
              toolCallId: part.toolCallId,
              outcome: 'success',
              output: part.output,
            } satisfies ToolExecutionEndStep;
            continue;
          }

          if (part.type === 'tool-error') {
            closeToolTiming(part.toolCallId);
            yield {
              type: 'tool_execution_end',
              toolCallId: part.toolCallId,
              outcome: 'error',
              error: typeof part.error === 'string' ? part.error : 'Tool execution failed',
            } satisfies ToolExecutionEndStep;
            continue;
          }

          if (part.type === 'error') {
            // The AI SDK emits error parts in fullStream for model-level
            // failures (NoOutputGeneratedError, gateway errors, etc.).
            // Collect them so the post-stream promise resolution can surface
            // the underlying cause instead of a generic "No output generated".
            const error = part.error as Error;
            logger.event({
              level: 'error',
              event: 'agent.stream.error_part',
              message: error?.message ?? 'Unknown stream error',
              error,
            });
            continue;
          }

          if (part.type === 'reasoning-delta' && part.text) {
            if (stepStartedAt !== null && firstDeltaAt === null) {
              firstDeltaAt = Date.now() - stepStartedAt;
              attemptFirstTokenSamples.push(firstDeltaAt);
            }
            yield {
              type: 'message_update',
              text: part.text,
              kind: 'reasoning',
            } satisfies MessageUpdateStep;
            continue;
          }

          if (part.type === 'start-step') {
            stepStartedAt = Date.now();
            firstDeltaAt = null;
            continue;
          }

          if (part.type === 'source') {
            collectedSources.push({
              sourceId: (part as { sourceId?: string }).sourceId ?? '',
              title: (part as { title?: string }).title,
              url: (part as { url?: string }).url,
            });
            continue;
          }

          // Markers and internal events — intentionally skipped.
          // text-start / text-end: text stream lifecycle markers (no data).
          // tool-input-start: handled above (name capture for execution start).
          // tool-input-delta: handled above (streamed input reassembly).
          // reasoning-start / reasoning-end: reasoning lifecycle markers (no data).
          // finish-step: step boundary marker (no actionable data; timing for
          //   step starts is handled above).
          // stream-start / response-metadata: lifecycle markers (no data).
          // raw: provider-internal events, not meaningful for consumers.
          if (
            part.type === 'text-start' ||
            part.type === 'text-end' ||
            part.type === 'reasoning-start' ||
            part.type === 'reasoning-end' ||
            part.type === 'finish-step' ||
            part.type === 'raw' ||
            part.type === 'finish'
          ) {
            continue;
          }
        }

        if (this.cancelRequested) {
          disposeLanguageModel(model);
          throw new Error('Run cancelled');
        }

        // Resolve post-stream promises independently. The AI SDK may reject
        // some of them with NoOutputGeneratedError when the outer stream
        // flush finds zero recorded steps (no finish chunk), even though
        // inner steps produced tool calls, tool results, and text deltas.
        // Replacing ALL values with empties would drop valid tool messages
        // and cause "insufficient tool messages" errors on retry.
        const resolveWithFallback = async <T>(
          promise: PromiseLike<T>,
          fallback: T,
        ): Promise<T> => {
          try {
            return await Promise.resolve(promise);
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === 'AI_NoOutputGeneratedError'
            ) {
              return fallback;
            }
            throw error;
          }
        };

        const responseObj = await resolveWithFallback(result.response, {
          id: 'no-output',
          timestamp: new Date(),
          modelId: config.model,
          messages: [] as Awaited<typeof result.response>['messages'],
        });

        const contentParts = await resolveWithFallback(
          result.content,
          [] as Awaited<typeof result.content>,
        );

        const totalUsage = normalizeLanguageModelUsage(
          await resolveWithFallback(
            Promise.resolve(result.totalUsage),
            undefined,
          ),
        );

        const finishReason: string | undefined =
          await Promise.resolve(result.finishReason).catch(
            (): undefined => undefined,
          );

        const steps = await resolveWithFallback(
          result.steps,
          [] as Awaited<typeof result.steps>,
        );

        cumulativeUsage = addUsage(cumulativeUsage, {
          ...EMPTY_USAGE,
          ...totalUsage,
        });

        // Detect model refusals
        if (finishReason === 'content-filter') {
          throw new RefusalError(
            'Model response was blocked by content filter',
            finishReason,
            streamedText || undefined
          );
        }
        if (finishReason === 'error') {
          throw new RefusalError(
            `Model produced an error response${streamedText ? `: ${streamedText.slice(0, 200)}` : ''}`,
            finishReason,
            streamedText || undefined
          );
        }

        // Persist history
        this.history = appendResponseMessages(history, responseObj.messages);
        history = this.history;
        totalSteps += steps.length;

        cumulativePerf = addTurnPerf(cumulativePerf, {
          llmMs: Math.max(0, Math.max(0, Date.now() - attemptStartedAt) - attemptToolMs),
          toolMs: attemptToolMs,
          firstTokenMs: attemptFirstTokenSamples.reduce((sum, ms) => sum + ms, 0),
          firstTokenSamples: attemptFirstTokenSamples.length,
          toolCalls: attemptToolCalls,
          steps: steps.length,
        });

        allText = allText ? allText + streamedText : streamedText;

        // Check for approval requests from both sources:
        // 1. result.content (post-stream promise) — the primary source.
        // 2. fullStream tool-approval-request parts — fallback when
        //    result.content rejects with NoOutputGeneratedError.
        const contentApprovalRequests = collectApprovalRequests(contentParts);
        const seenApprovalIds = new Set(contentApprovalRequests.map(r => r.approvalId));
        const mergedApprovalRequests = [...contentApprovalRequests];
        for (const streamReq of streamApprovalRequests) {
          if (!seenApprovalIds.has(streamReq.approvalId)) {
            seenApprovalIds.add(streamReq.approvalId);
            mergedApprovalRequests.push({
              approvalId: streamReq.approvalId,
              toolCallId: streamReq.toolCallId,
              toolCall: streamReq.toolCall
                ? normalizeCollectedToolCall(streamReq.toolCall as { toolName: string; input?: unknown; args?: unknown })
                : undefined,
            });
          }
        }
        if (mergedApprovalRequests.length > 0) {
          yield {
            type: 'approval_request',
            requests: mergedApprovalRequests,
          } satisfies ApprovalRequestStep;

          // Return so caller can gate approval and resume
          disposeLanguageModel(model);
          return {
            response: allText || streamedText,
            toolApprovalRequests: mergedApprovalRequests,
            usage: cumulativeUsage,
            ...(cumulativePerf ? { perf: cumulativePerf } : {}),
            iterations: totalSteps,
            requiresApproval: true,
          };
        }

        // Check for handoff
        const resultToolCalls = await result.toolCalls;
        if (terminalToolName === 'handoff') {
          const toolCalls = collectToolCalls(steps, resultToolCalls);
          const handoffCall = toolCalls?.find(tc => tc.toolName === 'handoff');
          const handoffArgs = handoffCall?.args as Record<string, unknown> | undefined;

          const handoffStep: HandoffStep = {
            type: 'handoff',
            summary:
              typeof handoffArgs?.summary === 'string'
                ? handoffArgs.summary
                : '',
            nextSteps:
              typeof handoffArgs?.next_steps === 'string'
                ? handoffArgs.next_steps
                : '',
            reason:
              typeof handoffArgs?.reason === 'string'
                ? handoffArgs.reason
                : 'other',
          };
          yield handoffStep;
        }

        // Success — emit finish and return
        const finalText =
          allText ||
          streamedText ||
          (await Promise.resolve(result.text).catch((): string => '')) ||
          '';

        // Soft refusal: empty response with no tool calls
        const hadToolCalls = steps.some(
          step => (step.toolCalls?.length ?? 0) > 0
        );
        if (!hadToolCalls && !finalText.trim()) {
          throw new RefusalError(
            'Model returned an empty response with no tool calls',
            finishReason,
            undefined
          );
        }

        const finishStep: TurnEndStep = {
          type: 'turn_end',
          outcome: 'completed',
          text: finalText,
          usage: cumulativeUsage,
          ...(collectedSources.length > 0 ? { sources: collectedSources } : {}),
        };
        yield finishStep;

        disposeLanguageModel(model);

        const allToolCalls = collectToolCalls(steps, resultToolCalls);

        return {
          response: finalText,
          ...(allToolCalls && allToolCalls.length > 0
            ? { toolCalls: allToolCalls }
            : {}),
          usage: cumulativeUsage,
          ...(cumulativePerf ? { perf: cumulativePerf } : {}),
          iterations: totalSteps,
        };
      } catch (error) {
        disposeLanguageModel(model);

        // Cancelled
        if (
          this.cancelRequested ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw error;
        }

        // Retryable error
        if (
          retryAttempt < retryMaxAttempts &&
          isRetryableError(error)
        ) {
          const delay = Math.min(
            retryBaseDelayMs * Math.pow(2, retryAttempt),
            retryMaxDelayMs
          );

          let recoveryNote: string;
          if (error instanceof RefusalError) {
            recoveryNote =
              'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.';
          } else {
            recoveryNote = `Your last attempt encountered an error: ${getErrorMessage(error)}. Please try a different approach or simplify your response to avoid this issue.`;
          }

          history = appendUserPromptToHistory(
            history,
            `${recoveryNote}\n\n---\nContinue with the original task.`
          );

          logger.event({
            level: 'warn',
            event: 'agent.stream.retry',
            outcome: 'started',
            message: `Stream failed, retrying (attempt ${retryAttempt + 1}/${retryMaxAttempts + 1}) after ${delay}ms`,
            error,
          });

          retryAttempt++;
          await sleep(delay);
          continue;
        }

        // Non-retryable error
        const errorStep: TurnEndStep = {
          type: 'turn_end',
          outcome: 'error',
          text: '',
          message: getErrorMessage(error),
          code:
            error instanceof RefusalError
              ? 'refusal'
              : error instanceof Error
                ? error.name
                : undefined,
        };
        yield errorStep;
        throw error;
      }
    }

    // Exhausted retries
    throw new Error('Agent run exhausted all retry attempts');
  }

  private buildTurnHistory(
    history: ModelMessage[] | undefined,
    prompt: string,
  ): ModelMessage[] {
    const base = history ? cloneModelMessages(history) : [];
    // When the prompt is empty AND we already have conversation history
    // (e.g. approval-resume flow), don't append an empty user message.
    // AI SDK v6 collectToolApprovals requires the last message to have
    // role 'tool' so it can match tool-approval-response parts against
    // prior tool-approval-request parts.
    if (!prompt.trim() && base.length > 0) return base;
    return appendUserPromptToHistory(base, prompt);
  }

  private buildToolSet(
    config: { enableTools: boolean; providerType: string },
    tools: AgentTool[] | undefined,
  ): ToolSet | undefined {
    if (!config.enableTools || !tools || tools.length === 0) return undefined;
    return buildAiToolSet(
      { enableTools: config.enableTools, providerType: config.providerType },
      tools
    ) as ToolSet | undefined;
  }
}

export const createSimpleAgentRunner = (
  config?: PartialAgentConfig & {
    modelFactory?: (
      providerType: string,
      modelId: string,
      providerId: string,
    ) => LanguageModel;
  },
): SimpleAgentRunner => new SimpleAgentRunner(config);
