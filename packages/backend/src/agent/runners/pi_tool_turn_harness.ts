import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';
import type { ModelMessage, ToolResultPart } from 'ai';

import { createLogger } from '@iki/backend/logger';
import { RefusalError, getErrorMessage, isRetryableError } from '@iki/backend/utils/errors';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import { withRetry } from '@iki/backend/utils/retry';
import { appendUserPromptToHistory, cloneModelMessages } from '../../provider/ai_sdk_runtime';
import { resolvePersonaPrompt, getProviderConfig } from '../../provider/llm/factory';
import {
  buildPiModel,
  callPiChat,
  projectHistoryToPiContext,
  projectToolsToPiTools,
} from '../../provider/llm/pi_adapter';
import {
  runPiAgentLoop,
  type PiLoopDelta,
  type PiLoopEvent,
  type PiLoopModelCall,
  type PiUsageBuckets,
} from './pi_agent_loop';
import { preparePiTurnHistory } from './pi_turn_budget';
import {
  createApprovalPolicyBox,
  advanceApprovalPolicySnapshot,
  resolveTools,
} from '../harness/tool_resolver';
import { estimateToolSchemaTokens } from '../context_budget';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '../../utils/runtime_context';
import type { AgentTool, AgentTurnPerf, AgentUsage } from '../types';
import type { HarnessConfig, TurnEvent, TurnInput, TurnOutput } from '../harness/harness_types';

const logger = createLogger({ module: 'pi_tool_turn_harness' });

/**
 * The tool-enabled streaming turn harness over the Pi supply layer — switch
 * item 3a (issue #114), the production wiring of the candidate loop.
 *
 * Routing contract (session_loop): `plan.enableTools &&
 * plan.approvalPolicy === 'never' && !autonomous && supportsPiTurnSupply`.
 * The harness ENFORCES its half of that gate: a config whose approval policy
 * is not 'never' is refused at turn start, because the pause/resume redesign
 * (3b) is not wired — under 'never' the resolver's call-time approval
 * function returns false unconditionally, so the loop's awaiting-approval
 * branch is unreachable by construction and this harness projects
 * `needsApproval: false` for every tool.
 *
 * Contract parity with the AI SDK runner for the tool subset:
 * - tools resolved by the same owner (`resolveTools`) with the same per-step
 *   policy snapshot (advanced after each step);
 * - tools executed inline: runtime context bound (thread, run, workspace
 *   snapshot, abort signal, available tools), structured-clone args, the
 *   tool's own retry config honored; results carried in the canonical
 *   ToolResultOutput vocabulary (text / json / error-text) — the same shape
 *   the driver projects to the UI and history keeps;
 * - the loop's events map 1:1 onto the TurnDriver protocol — live
 *   text/thinking deltas as message_update steps, tool_execution_start
 *   yielded BEFORE the effect and tool_execution_end AFTER it (generator
 *   suspension keeps "executing right now" visible);
 * - transient model-call failures retry with the runner's bounds (3 retries,
 *   shared isRetryableError classifier, exponential backoff) and the same
 *   two recovery notes, pushed onto the LIVE transcript so they persist
 *   across the turn — but only while the failed call streamed nothing;
 * - history stays ModelMessage-shaped end to end (thinking → reasoning
 *   parts, tool results as tool messages); getHistory returns a clone;
 * - the input budget runs once at turn start through the shared
 *   preparePiTurnHistory (per-step re-compaction is a tracked 3b item; the
 *   step count bounds 3a turns);
 * - an empty response with no tool calls is a RefusalError; aborts throw
 *   DOMException('AbortError'); provider errors throw after the retry
 *   budget — the driver's cancel/steer/failure classification keys off the
 *   error name;
 * - terminal mapping: loop 'completed' → finishReason 'stop';
 *   'budget-exhausted' → finishReason 'tool-calls' (the driver reports
 *   budget-exhausted with the pending calls carried in toolCalls).
 *
 * Live deltas stream as they arrive — shown ⊆ committed stays downstream,
 * in the TurnDriver's buffer gate.
 */

/** The narrow call surface this harness consumes: the harness hands the
 * harness config, the loop's LIVE transcript, the projected tools and the
 * signal; the production implementation resolves the provider row, builds
 * the Pi model, and streams one attempt with the runner's retry bounds.
 * Tests hand scripted doubles. */
export type PiToolModelCall = (
  config: HarnessConfig,
  request: {
    systemPrompt: string;
    /** The loop's live transcript — retry notes pushed here persist. */
    messages: PiMessage[];
    tools?: ReturnType<typeof projectToolsToPiTools>;
    signal?: AbortSignal;
    maxTokens?: number;
  }
) => { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> };

// The runner's retry bounds (simple_agent_runner): 3 retries, exponential
// backoff capped at 30s, only while nothing has streamed in THIS call.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const CONTENT_FILTER_PATTERN = /content_filter/i;

const recoveryNoteFor = (failure: Error): string =>
  (failure instanceof RefusalError
    ? 'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.'
    : `Your last attempt encountered an error: ${getErrorMessage(failure)}. Please try a different approach or simplify your response to avoid this issue.`) +
  '\n\n---\nContinue with the original task.';

/**
 * The production model call: one live-delta stream per attempt with the
 * runner's retry bounds. A queued-buffer decouples the attempt task from
 * the loop's consumption so a retry's deltas keep flowing after the failed
 * attempt's stream ended.
 */
const defaultPiToolModelCall: PiToolModelCall = (config, request) => {
  const queue: PiLoopDelta[] = [];
  let notify: (() => void) | undefined;
  let done = false;
  const pushDelta = (delta: PiLoopDelta) => {
    queue.push(delta);
    notify?.();
  };
  const waitDelta = () => new Promise<void>(resolve => { notify = resolve; });

  const finalPromise = (async () => {
    try {
      const provider = getProviderConfig(config.providerType, config.providerId);
      const model = buildPiModel({
        id: config.model,
        baseUrl: provider.baseURL,
        contextWindow: 128000,
        maxTokens: config.maxOutputTokens ?? 4096,
      });
      let attempt = 0;
      for (;;) {
        const stream = callPiChat(
          model,
          { systemPrompt: request.systemPrompt, messages: request.messages, tools: request.tools },
          {
            apiKey: provider.apiKey,
            ...(request.signal ? { signal: request.signal } : {}),
            ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
          }
        );
        let streamed = false;
        for await (const event of stream) {
          if (event.type === 'text_delta' && event.delta) {
            streamed = true;
            pushDelta({ type: 'text_delta', delta: event.delta });
          } else if (event.type === 'thinking_delta' && event.delta) {
            streamed = true;
            pushDelta({ type: 'thinking_delta', delta: event.delta });
          }
        }
        const final = await stream.result();
        if (final.stopReason === 'error') {
          const failure = CONTENT_FILTER_PATTERN.test(final.errorMessage ?? '')
            ? new RefusalError(
                'Model response was blocked by content filter',
                'content-filter',
                undefined
              )
            : new Error(final.errorMessage || 'Provider returned an error stop reason');
          if (
            attempt < RETRY_MAX_ATTEMPTS &&
            !streamed &&
            !request.signal?.aborted &&
            isRetryableError(failure)
          ) {
            attempt += 1;
            await sleep(Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS));
            // The recovery note joins the LIVE transcript — it rides every
            // later step of this turn (runner parity).
            request.messages.push({
              role: 'user',
              content: recoveryNoteFor(failure),
              timestamp: Date.now(),
            });
            logger.event({
              level: 'warn',
              event: 'llm.turn.retry',
              outcome: 'started',
              message: `Pi tool turn step failed, retrying (attempt ${attempt}/${RETRY_MAX_ATTEMPTS})`,
              data: { providerType: config.providerType, model: config.model, errorMessage: getErrorMessage(failure) },
            });
            continue;
          }
        }
        return final;
      }
    } finally {
      done = true;
      notify?.();
    }
  })();

  const events = (async function* () {
    let index = 0;
    for (;;) {
      while (index < queue.length) {
        yield queue[index];
        index += 1;
      }
      if (done) return;
      await waitDelta();
    }
  })();

  return { events, final: finalPromise };
};

/** Inline execution parity with the AI SDK adapter: runtime context bound
 * (thread, abort signal, available tools — the turn's workspace snapshot
 * rides the driver's context), structured-clone args, the tool's own retry
 * config honored. Results land in the canonical ToolResultOutput
 * vocabulary; unknown tool names become error results, never throws. */
const defaultPiToolExecutor = (tools: AgentTool[], threadId?: string) => {
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  return async (call: { name: string; arguments: Record<string, unknown> }, signal?: AbortSignal): Promise<ToolResultOutput> => {
    const tool = byName.get(call.name);
    if (!tool) {
      return { type: 'error-text', value: `Unknown tool "${call.name}".` };
    }
    try {
      const value = await runWithToolRuntimeContext(
        {
          ...getToolRuntimeContext(),
          ...(threadId ? { threadId } : {}),
          abortSignal: signal,
          availableTools: tools,
        },
        async () => {
          const invoke = () => tool.handler(structuredClone(call.arguments));
          return tool.retry ? withRetry(invoke, tool.retry)() : invoke();
        }
      );
      return typeof value === 'string'
        ? { type: 'text', value }
        : { type: 'json', value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (error) {
      return { type: 'error-text', value: getErrorMessage(error) };
    }
  };
};

/** Tool result output in the canonical ToolResultOutput vocabulary. */
type ToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string };

export class PiToolTurnHarness {
  private readonly config: HarnessConfig;
  private readonly modelCall: PiToolModelCall;
  private readonly executorOverride?: (call: { name: string; arguments: Record<string, unknown> }, signal?: AbortSignal) => Promise<unknown>;
  private history: ModelMessage[] = [];

  constructor(
    config: HarnessConfig,
    deps?: {
      modelCall?: PiToolModelCall;
      executeTool?: (call: { name: string; arguments: Record<string, unknown> }, signal?: AbortSignal) => Promise<unknown>;
    }
  ) {
    if (config.approvalPolicy !== 'never') {
      throw new Error(
        'PiToolTurnHarness serves only the never-approve policy; other policies wait for the approval-resume slice.'
      );
    }
    this.config = config;
    this.modelCall = deps?.modelCall ?? defaultPiToolModelCall;
    this.executorOverride = deps?.executeTool;
  }

  async *turn(input: TurnInput): AsyncGenerator<TurnEvent, void> {
    const signal = input.abortSignal;
    signal?.throwIfAborted();
    if (input.toolsOverride?.length) {
      throw new Error('PiToolTurnHarness does not support toolsOverride; delegated subagents keep the AgentHarness.');
    }

    const policyBox = createApprovalPolicyBox(this.config.approvalPolicy);
    const tools = resolveTools({
      enableTools: this.config.enableTools,
      enabledToolNames: this.config.enabledToolNames,
      availableSkillIds: this.config.availableSkillIds,
      guardActive: this.config.guardActive,
      requireApproval: this.config.requireApproval,
      autoApproveToolRequests: this.config.autoApproveToolRequests ?? false,
      ...(this.config.approvalPolicy ? { approvalPolicy: this.config.approvalPolicy } : {}),
      approvalPolicyBox: policyBox,
    });
    const piTools = tools.length
      ? projectToolsToPiTools(tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })))
      : undefined;
    const toolSchemaTokens = tools.length ? estimateToolSchemaTokens(tools) : undefined;

    this.history = this.buildTurnHistory(input.history, input.prompt);

    const personaPrompt = resolvePersonaPrompt(this.config.providerType, this.config.providerId);
    const firstTranscriptSystem = this.history.find(
      (message): message is Extract<ModelMessage, { role: 'system' }> => message.role === 'system'
    );
    const { requestHistory } = await preparePiTurnHistory({
      history: this.history,
      personaPrompt,
      planPrompt: this.config.systemPrompt,
      transcriptSystemText:
        typeof firstTranscriptSystem?.content === 'string' ? firstTranscriptSystem.content : '',
      ...(typeof this.config.maxInputTokens === 'number' ? { maxInputTokens: this.config.maxInputTokens } : {}),
      ...(this.config.threadId ? { threadId: this.config.threadId } : {}),
      ...(signal ? { signal } : {}),
    });

    const projected = projectHistoryToPiContext(requestHistory, this.config.model);
    const { prompt: systemPrompt } = assembleRequestSystemPrompt([
      { slot: 'persona', text: personaPrompt },
      { slot: 'planPrompt', text: this.config.systemPrompt },
      { slot: 'transcriptSystem', text: projected.systemPrompt },
    ]);

    // The loop owns the Pi transcript (it appends assistant/toolResult
    // entries); the harness mirrors every append in ModelMessage shape for
    // getHistory/onInference — single writer per side, same order.
    const transcript: PiMessage[] = projected.messages;
    const turnStartedAt = Date.now();
    let firstDeltaMs: number | null = null;
    let streamedText = '';
    let llmMs = 0;
    let toolMs = 0;
    let toolCallsCount = 0;
    const toolCallResults: Array<{ toolName: string; args: Record<string, unknown>; result?: unknown }> = [];
    const sentSnapshots: ModelMessage[][] = [];

    const executor =
      this.executorOverride ?? defaultPiToolExecutor(tools, this.config.threadId);

    const iterator = runPiAgentLoop({
      systemPrompt,
      messages: transcript,
      ...(piTools ? { tools: piTools } : {}),
      maxSteps: this.config.maxIterations,
      callModel: (context: { systemPrompt: string; messages: PiMessage[]; tools?: unknown }) => {
        // Snapshot at call time = exactly what this step sends (the mirror
        // grows afterwards).
        sentSnapshots.push([...this.history]);
        return this.modelCall(this.config, {
          systemPrompt: context.systemPrompt,
          messages: context.messages,
          tools: piTools,
          ...(signal ? { signal } : {}),
          ...(typeof this.config.maxOutputTokens === 'number'
            ? { maxTokens: this.config.maxOutputTokens }
            : {}),
        });
      },
      executeTool: async call => {
        const startedAt = Date.now();
        toolCallsCount += 1;
        const output = await executor(call, signal);
        toolMs += Math.max(0, Date.now() - startedAt);
        return output;
      },
      ...(signal ? { signal } : {}),
    });

    let next = await iterator.next();
    while (!next.done) {
      const event = next.value as PiLoopEvent;
      if (event.type === 'text_delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - turnStartedAt;
        streamedText += event.delta;
        yield {
          event: 'step',
          step: { type: 'message_update', text: event.delta, kind: 'text' },
        };
      } else if (event.type === 'thinking_delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - turnStartedAt;
        yield {
          event: 'step',
          step: { type: 'message_update', text: event.delta, kind: 'reasoning' },
        };
      } else if (event.type === 'step_end') {
        const step = event.step;
        // End of one step = start of the next policy snapshot (harness parity).
        advanceApprovalPolicySnapshot(policyBox, this.config.approvalPolicy);
        // The assistant message joins the mirror ONCE per step: thinking →
        // reasoning parts, text, then tool-call parts (AI SDK vocabulary).
        const assistantParts: Array<
          | { type: 'text'; text: string }
          | { type: 'reasoning'; text: string }
          | { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
        > = [];
        if (step.thinking) assistantParts.push({ type: 'reasoning', text: step.thinking });
        if (step.text) assistantParts.push({ type: 'text', text: step.text });
        for (const call of step.toolCalls) {
          assistantParts.push({
            type: 'tool-call',
            toolCallId: call.id,
            toolName: call.name,
            input: call.arguments,
          });
        }
        this.history = [...this.history, { role: 'assistant', content: assistantParts }];

        const stepUsage: AgentUsage = mapBuckets(step.usage);
        input.onInference?.({
          messages: sentSnapshots.at(-1) ?? requestHistory,
          systemPrompt,
          content: assistantParts,
          finishReason: step.toolCalls.length > 0 ? 'tool-calls' : 'stop',
          usage: stepUsage,
        });
      } else if (event.type === 'tool_start') {
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_start',
            toolCallId: event.call.id,
            toolName: event.call.name,
            input: event.call.arguments,
          },
        };
      } else {
        const isError = toolOutputIsError(event.output);
        toolCallResults.push({
          toolName: event.call.name,
          args: event.call.arguments,
          result: event.output,
        });
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_end',
            toolCallId: event.call.id,
            outcome: isError ? ('error' as const) : ('success' as const),
            output: event.output,
            ...(isError ? { error: toolOutputText(event.output) } : {}),
          },
        };
        this.history = [
          ...this.history,
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: event.call.id,
                toolName: event.call.name,
                output: event.output as ToolResultPart['output'],
              },
            ],
          },
        ];
      }
      next = await iterator.next();
    }
    const outcome = next.value;
    llmMs = Math.max(0, Date.now() - turnStartedAt - toolMs);

    const usage: AgentUsage = mapBuckets(outcome.usage);
    const perf: AgentTurnPerf = {
      llmMs,
      toolMs,
      firstTokenMs: firstDeltaMs ?? 0,
      firstTokenSamples: firstDeltaMs === null ? 0 : 1,
      toolCalls: toolCallsCount,
      steps: outcome.steps.length,
    };

    if (outcome.status === 'awaiting-approval') {
      // Unreachable under the never-approve gate (the resolver's call-time
      // function returns false unconditionally and no approval surface is
      // wired). Fail loudly rather than pretend.
      throw new Error('Pi tool turn reached the approval pause with no approval surface wired.');
    }
    if (
      outcome.status === 'completed' &&
      toolCallResults.length === 0 &&
      !outcome.finalText.trim() &&
      !streamedText.trim()
    ) {
      throw new RefusalError('Model returned an empty response with no tool calls', 'stop', undefined);
    }

    const text = streamedText || outcome.finalText;
    const finishReason = outcome.status === 'budget-exhausted' ? 'tool-calls' : 'stop';
    yield {
      event: 'step',
      step: { type: 'turn_end', outcome: 'completed', text, usage },
    };
    const output: TurnOutput = {
      text,
      usage,
      ...(usage.inputTokens > 0 ? { lastStepInputTokens: usage.inputTokens } : {}),
      perf,
      ...(toolSchemaTokens ? { toolSchemaTokens } : {}),
      requiresApproval: false,
      finishReason,
      ...(toolCallResults.length > 0 ? { toolCalls: toolCallResults } : {}),
    };
    yield { event: 'done', output };
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }

  private buildTurnHistory(history: ModelMessage[] | undefined, prompt: string): ModelMessage[] {
    const base = cloneModelMessages(history);
    // Same rule as the AI SDK runner: an empty prompt over existing history
    // (resume shapes) must not append an empty user message.
    if (!prompt.trim() && base.length > 0) return base;
    return appendUserPromptToHistory(base, prompt);
  }
}

/** The linear bucket mapping (projectUsageToIki) over the loop's raw
 * buckets — no cost table on the Pi model yet (tracked). */
const mapBuckets = (buckets: PiUsageBuckets): AgentUsage => ({
  inputTokens: buckets.input + buckets.cacheRead + buckets.cacheWrite,
  outputTokens: buckets.output,
  cacheReadTokens: buckets.cacheRead,
  cacheWriteTokens: buckets.cacheWrite,
  reasoningTokens: buckets.reasoning,
  totalTokens: buckets.totalTokens,
  estimatedCostUsd: 0,
});

const toolOutputIsError = (output: unknown): boolean =>
  output !== null &&
  typeof output === 'object' &&
  'type' in output &&
  ((output as { type: string }).type === 'error-text' ||
    (output as { type: string }).type === 'error-json' ||
    (output as { type: string }).type === 'execution-denied');

const toolOutputText = (output: unknown): string =>
  output !== null && typeof output === 'object' && 'value' in output
    ? String((output as { value: unknown }).value)
    : 'Tool execution failed';
