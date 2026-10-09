import { randomUUID } from 'node:crypto';
import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';
import type { ModelMessage, ToolResultPart } from 'ai';

import { createLogger } from '@iki/backend/logger';
import { RefusalError, getErrorMessage, isRetryableError } from '@iki/backend/utils/errors';
import type { ToolApprovalRequest } from '../types';
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
import { TERMINAL_TOOL_NAMES } from './simple_agent_runner';
import {
  runPiAgentLoop,
  toolResultIsError as toolExecutionIsError,
  toolResultText as toolExecutionText,
  type PiLoopDelta,
  type PiLoopEvent,
  type PiLoopModelCall,
  type PiLoopTool,
  type PiUsageBuckets,
} from './pi_agent_loop';
import { preparePiTurnHistory, compactPiRequestStep } from './pi_turn_budget';
import {
  createApprovalPolicyBox,
  advanceApprovalPolicySnapshot,
  resolveTools,
} from '../harness/tool_resolver';
import { estimateMessageTokens, estimateTextTokens, estimateToolSchemaTokens } from '../context_budget';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '../../utils/runtime_context';
import type { AgentTool, AgentTurnPerf, AgentUsage } from '../types';
import type { HarnessConfig, TurnEvent, TurnInput, TurnOutput } from '../harness/harness_types';

const logger = createLogger({ module: 'pi_tool_turn_harness' });

/**
 * The tool-enabled streaming turn harness over the Pi supply layer — switch
 * item 3a (issue #114), the production wiring of the candidate loop.
 *
 * Routing (thread_session/turn_supply_selection.ts): `plan.enableTools &&
 * supportsPiTurnSupply` — every mode (autonomous chains rebuild through the
 * same selector, 3c) and every approval policy served.
 * Approval semantics: the resolver's per-call decision rides the loop tool
 * (evaluated before any effect); the needing calls are reported as the
 * standard approval_request step + requiresApproval done — persistence stays
 * with the driver's registerApprovalBatch. Resume executes the decided calls
 * through the injected five-state owner port (admitted by the approval
 * module before the legacy consume), then continues the loop.
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
 * - the input budget runs the prepareStep cadence: once at turn start
 *   through the shared preparePiTurnHistory and again before EVERY model
 *   call through compactPiRequestStep — over the threshold the request view
 *   compacts (request-scoped; the stored mirror keeps the full text, the
 *   snapshot basis switches to what was actually sent) and a view that
 *   cannot fit even compacted refuses loudly;
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
    /** Retry recovery notes: the mirror must stay in step with what the
     * transcript now carries (runner parity — notes persist in history on
     * success and are flushed before the next assistant entry). */
    onRecoveryNote?: (noteText: string) => void;
  }
) => { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> };

// The runner's retry bounds (simple_agent_runner): 3 retries, exponential
// backoff capped at 30s, only while nothing has streamed in THIS call.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const CONTENT_FILTER_PATTERN = /content_filter/i;

/** Absorbs the projection's systemPrompt slot during a per-request compaction
 * rebuild — never reaches the wire (the rebuild keeps only `messages`). */
const PER_REQUEST_COMPACT_PLACEHOLDER = '__iki_compaction_slot__';

const recoveryNoteFor = (failure: Error): string =>
  (failure instanceof RefusalError
    ? 'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.'
    : `Your last attempt encountered an error: ${getErrorMessage(failure)}. Please try a different approach or simplify your response to avoid this issue.`) +
  '\n\n---\nContinue with the original task.';

/**
 * The runner's retry bounds wrapped around one attempt factory: transient
 * failures and refusals retry (3 retries, shared isRetryableError, exponential
 * backoff) but only while the failed call streamed nothing — shown text is
 * never re-shown. Recovery notes join the LIVE transcript (riding every later
 * step) AND reach `onRecoveryNote` so the caller's ModelMessage mirror stays
 * in step with what was sent. Terminal failures are CLASSIFIED here: a
 * content-filter finish reason throws the runner's RefusalError, an aborted
 * signal throws DOMException('AbortError') — the driver's cancel/steer/failure
 * classification keys off these. A queued-buffer decouples the attempt task
 * from the loop's consumption so a retry's deltas keep flowing after the
 * failed attempt's stream ended.
 */
export const withPiRetry = (
  attempt: () => { stream: AsyncIterable<PiStreamEvent>; final: Promise<AssistantMessage> },
  request: { messages: PiMessage[]; signal?: AbortSignal },
  onRecoveryNote?: (noteText: string) => void
): { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> } => {
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
      let attemptIndex = 0;
      for (;;) {
        const one = attempt();
        let streamed = false;
        for await (const event of one.stream) {
          if (event.type === 'text_delta' && event.delta) {
            streamed = true;
            pushDelta({ type: 'text_delta', delta: event.delta });
          } else if (event.type === 'thinking_delta' && event.delta) {
            streamed = true;
            pushDelta({ type: 'thinking_delta', delta: event.delta });
          }
        }
        const final = await one.final;
        if (final.stopReason === 'error') {
          const failure = CONTENT_FILTER_PATTERN.test(final.errorMessage ?? '')
            ? new RefusalError(
                'Model response was blocked by content filter',
                'content-filter',
                undefined
              )
            : new Error(final.errorMessage || 'Provider returned an error stop reason');
          if (
            attemptIndex < RETRY_MAX_ATTEMPTS &&
            !streamed &&
            !request.signal?.aborted &&
            isRetryableError(failure)
          ) {
            attemptIndex += 1;
            await sleep(Math.min(RETRY_BASE_DELAY_MS * 2 ** (attemptIndex - 1), RETRY_MAX_DELAY_MS));
            const note = recoveryNoteFor(failure);
            // The note joins the LIVE transcript and the caller's mirror
            // signal — it rides every later step of this turn (runner parity).
            request.messages.push({ role: 'user', content: note, timestamp: Date.now() });
            onRecoveryNote?.(note);
            logger.event({
              level: 'warn',
              event: 'llm.turn.retry',
              outcome: 'started',
              message: `Pi tool turn step failed, retrying (attempt ${attemptIndex}/${RETRY_MAX_ATTEMPTS})`,
              data: { errorMessage: getErrorMessage(failure) },
            });
            continue;
          }
          // Terminal: classify for the driver before handing the failure over.
          if (request.signal?.aborted) {
            throw new DOMException(final.errorMessage || 'Run cancelled', 'AbortError');
          }
          if (failure instanceof RefusalError) throw failure;
          logger.event({
            level: 'error',
            event: 'llm.turn.failed',
            outcome: 'failed',
            message: 'Pi tool turn step failed terminally.',
            data: { errorMessage: getErrorMessage(failure) },
          });
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

/** One live attempt's delta events (the slice of Pi's stream the loop needs). */
export type PiStreamEvent = { type: 'text_delta' | 'thinking_delta'; delta: string };

const defaultPiToolModelCall: PiToolModelCall = (config, request) => {
  const provider = getProviderConfig(config.providerType, config.providerId);
  const model = buildPiModel({
    id: config.model,
    baseUrl: provider.baseURL,
    contextWindow: 128000,
    maxTokens: config.maxOutputTokens ?? 4096,
  });
  return withPiRetry(
    () => {
      const stream = callPiChat(
        model,
        { systemPrompt: request.systemPrompt, messages: request.messages, tools: request.tools },
        {
          apiKey: provider.apiKey,
          ...(request.signal ? { signal: request.signal } : {}),
          ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
        }
      );
      return {
        stream: stream as unknown as AsyncIterable<PiStreamEvent>,
        final: stream.result(),
      };
    },
    request,
    request.onRecoveryNote
  );
};

/** The raw tool invocation (handler + clone + retry + context binding) —
 * returns the handler's RAW value; the callers wrap it into their own result
 * vocabulary. Unknown tool names throw here; the wrappers convert. */
const createRawToolRunner = (tools: AgentTool[], config: HarnessConfig) => {
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  return async (toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
    const tool = byName.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool "${toolName}".`);
    }
    return runWithToolRuntimeContext(
      {
        ...getToolRuntimeContext(),
        ...(config.threadId ? { threadId: config.threadId } : {}),
        abortSignal: signal,
        availableTools: tools,
        availableSkillIds: config.availableSkillIds,
      },
      async () => {
        const invoke = () => tool.handler(structuredClone(args));
        return tool.retry ? withRetry(invoke, tool.retry)() : invoke();
      }
    );
  };
};

/** Inline execution parity with the AI SDK adapter: results land in the
 * canonical ToolResultOutput vocabulary; unknown tool names become error
 * results, never throws. */
const defaultPiToolExecutor = (tools: AgentTool[], config: HarnessConfig) => {
  const runRaw = createRawToolRunner(tools, config);
  return async (call: { name: string; arguments: Record<string, unknown> }, signal?: AbortSignal): Promise<ToolResultOutput> => {
    try {
      const value = await runRaw(call.name, call.arguments, signal);
      return typeof value === 'string'
        ? { type: 'text', value }
        : { type: 'json', value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (error) {
      return { type: 'error-text', value: getErrorMessage(error) };
    }
  };
};

/** Structural mirror of the approval owner's outcome — thread_session owns
 * the shape; this module must not import it (agent-below-session). The
 * completed result is the canonical tool-result record. */
export type ToolExecutionOutcome =
  | { kind: 'pending' | 'unknown' | 'busy' }
  | {
      kind: 'completed';
      reused: boolean;
      result: { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown };
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
  private readonly resume?: {
    commands: Array<{ approvalId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }>;
    owner: {
      prepare: (address: { threadId: string; approvalId: string }) => void;
      executeApproved: (
        address: { threadId: string; approvalId: string },
        port: { signal?: AbortSignal; execute: (toolName: string, args: unknown) => Promise<unknown> }
      ) => Promise<ToolExecutionOutcome>;
    };
  };
  private history: ModelMessage[] = [];

  constructor(
    config: HarnessConfig,
    deps?: {
      modelCall?: PiToolModelCall;
      /** Intercepts MODEL-driven tool calls after the resume block. Owner-
       * executed resume calls (the five-state port) run RAW and do NOT pass
       * through this — record them at the owner port instead. */
      executeTool?: (call: { name: string; arguments: Record<string, unknown> }, signal?: AbortSignal) => Promise<unknown>;
      /** Resume mode (switch item 3b): the decided calls of a paused turn,
       * read back from the approval rows, and the five-state owner port.
       * The thread_session construction site injects the owner — this module
       * must not import it (agent-below-session). */
      resume?: {
        commands: Array<{ approvalId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }>;
        owner: {
          prepare: (address: { threadId: string; approvalId: string }) => void;
          executeApproved: (
            address: { threadId: string; approvalId: string },
            port: { signal?: AbortSignal; execute: (toolName: string, args: unknown) => Promise<unknown> }
          ) => Promise<ToolExecutionOutcome>;
        };
      };
    }
  ) {
    this.config = config;
    this.modelCall = deps?.modelCall ?? defaultPiToolModelCall;
    this.executorOverride = deps?.executeTool;
    this.resume = deps?.resume;
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
    // Per-call approval decision: the resolver's function (policy box state
    // in its closure) rides the loop tool; the loop evaluates it before any
    // effect. Booleans pass through.
    const loopTools: PiLoopTool[] | undefined = piTools?.map(piTool => {
      const agentTool = tools.find(candidate => candidate.name === piTool.name);
      return {
        ...piTool,
        needsApproval:
          typeof agentTool?.needsApproval === 'function'
            ? (input: unknown, context: { toolCallId: string; messages: PiMessage[] }) => {
                const decide = agentTool.needsApproval;
                return Boolean(
                  typeof decide === 'function' ? decide(input, context) : decide === true
                );
              }
            : agentTool?.needsApproval === true,
      };
    });
    const toolSchemaTokens = tools.length ? estimateToolSchemaTokens(tools) : undefined;

    this.history = this.buildTurnHistory(input.history, input.prompt);

    const personaPrompt = resolvePersonaPrompt(this.config.providerType, this.config.providerId);
    const firstTranscriptSystem = this.history.find(
      (message): message is Extract<ModelMessage, { role: 'system' }> => message.role === 'system'
    );
    // The AI SDK overhead formula: system prompt + the tool schemas' JSON
    // size (the schemas sit in the cached region ahead of every message).
    const toolSchemaOverheadTokens = piTools ? estimateTextTokens(JSON.stringify(piTools)) : 0;
    const transcriptSystemText =
      typeof firstTranscriptSystem?.content === 'string' ? firstTranscriptSystem.content : '';
    const { requestHistory, summaryMessage: turnStartSummaryMessage } = await preparePiTurnHistory({
      history: this.history,
      personaPrompt,
      planPrompt: this.config.systemPrompt,
      transcriptSystemText,
      toolSchemaTokens: toolSchemaOverheadTokens,
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
    // getHistory/onInference — single writer per side, same order. The FULL
    // mirror is the stored-history authority (getHistory); `requestView` is
    // what the model actually sees — identical to the mirror until a
    // compaction replaces it (prepareStep parity), after which the two share
    // appends but the view stays compacted. Retry notes sit in pendingNotes
    // until the next assistant entry flushes them (runner parity: notes
    // persist in history on success, never on a turn that ultimately fails).
    const transcript: PiMessage[] = projected.messages;
    let requestView: ModelMessage[] = requestHistory;
    let summaryMessage = turnStartSummaryMessage;
    // Mutable: after a compaction the summaries ride as MESSAGES, so the
    // request system prompt reassembles with the original transcript system
    // only — a turn-start summary that the projection funneled into the slot
    // (no-transcript-system shape) must not linger on the wire stale.
    let requestSystemPrompt = systemPrompt;
    const overheadTokens = estimateTextTokens(systemPrompt) + toolSchemaOverheadTokens;
    const turnStartedAt = Date.now();
    let firstDeltaMs: number | null = null;
    let streamedText = '';
    let llmMs = 0;
    let toolMs = 0;
    let toolCallsCount = 0;
    let lastStepUsage: AgentUsage | undefined;
    const pendingNotes: ModelMessage[] = [];
    const toolCallResults: Array<{ toolName: string; args: Record<string, unknown>; result?: unknown }> = [];
    const sentSnapshots: ModelMessage[][] = [];

    const executor =
      this.executorOverride ?? defaultPiToolExecutor(tools, this.config);

    // Resume mode (switch item 3b): execute the decided calls of the paused
    // turn through the five-state owner FIRST — approved calls run exactly
    // once (crash-safe, owner-adjudicated), rejections produce the canonical
    // execution-denied result — then continue the loop with the empty
    // prompt. The owner outcomes that cannot occur under full-batch
    // decisions (pending) or signal cross-process conflicts (unknown, busy)
    // fail loudly instead of inventing a result.
    if (this.resume && this.resume.commands.length > 0) {
      if (!this.config.threadId) {
        throw new Error("Resuming an approval requires the paused turn thread id.");
      }
      for (const command of this.resume.commands) {
        const address = { threadId: this.config.threadId, approvalId: command.approvalId };
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_start',
            toolCallId: command.toolCallId,
            toolName: command.toolName,
            input: command.args,
          },
        };
        this.resume.owner.prepare(address);
        // The owner requires a signal — supply a fresh controller when the
        // turn carries none.
        const ownerSignal = signal ?? new AbortController().signal;
        // The owner's port contract expects the RAW handler value — the
        // owner applies the canonical result wrapping itself.
        const runRaw = createRawToolRunner(tools, this.config);
        const outcome = await this.resume.owner.executeApproved(address, {
          signal: ownerSignal,
          execute: (toolName, args) =>
            runRaw(toolName, args as Record<string, unknown>, ownerSignal),
        });
        if (outcome.kind !== 'completed') {
          throw new Error(
            `Approved tool "${command.toolName}" could not be executed (${outcome.kind}); the turn cannot continue honestly.`
          );
        }
        toolCallsCount += 1;
        const output = outcome.result.output as ToolResultPart['output'];
        const isError = toolExecutionIsError(output);
        toolCallResults.push({
          toolName: outcome.result.toolName,
          args: command.args,
          result: output,
        });
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_end',
            toolCallId: outcome.result.toolCallId,
            outcome: isError ? ('error' as const) : ('success' as const),
            output,
            ...(isError ? { error: toolOutputText(output) } : {}),
          },
        };
        // Mirror and transcript: same appends the loop would make.
        const resumeResultMessage: ModelMessage = {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: outcome.result.toolCallId, toolName: outcome.result.toolName, output }],
        };
        this.history = [...this.history, resumeResultMessage];
        requestView = [...requestView, resumeResultMessage];
        transcript.push({
          role: 'toolResult',
          toolCallId: outcome.result.toolCallId,
          toolName: outcome.result.toolName,
          content: [{ type: 'text', text: toolExecutionText(output) }],
          isError,
          timestamp: Date.now(),
        });
      }
    }

    // Pause-side reporting: the harness allocates approvalIds and records
    // the needing calls; PERSISTENCE stays with the driver's
    // registerApprovalBatch (done handling) — the harness only reports.
    const pendingApprovalRequests: ToolApprovalRequest[] = [];
    const iterator = runPiAgentLoop({
      systemPrompt,
      messages: transcript,
      ...(loopTools ? { tools: loopTools } : {}),
      maxSteps: this.config.maxIterations,
      terminalToolNames: TERMINAL_TOOL_NAMES,
      requestApproval: async call => {
        pendingApprovalRequests.push({
          approvalId: randomUUID(),
          toolCallId: call.id,
          toolCall: { toolName: call.name, args: call.arguments },
        });
      },
      callModel: async (context: { systemPrompt: string; messages: PiMessage[]; tools?: unknown }) => {
        // prepareStep parity: EVERY request re-checks the input budget.
        // Under the threshold this is one estimate pass; over it, the
        // REQUEST view compacts (the stored mirror stays full) and the
        // transcript rebuilds in place — the loop's messages alias sees the
        // new contents. A view that cannot fit even after compaction
        // refuses loudly (no silent truncation).
        if (typeof this.config.maxInputTokens === 'number') {
          const compactionStartedAt = Date.now();
          const planned = await compactPiRequestStep({
            requestView,
            maxInputTokens: this.config.maxInputTokens,
            overheadTokens,
            ...(this.config.threadId ? { threadId: this.config.threadId } : {}),
            ...(signal ? { signal } : {}),
            ...(summaryMessage && typeof summaryMessage.content === 'string'
              ? { existingSummary: summaryMessage.content }
              : {}),
            // Identity of the view's CURRENT summary — the owner excludes it
            // from the kept systems so the new summary replaces it.
            ...(summaryMessage ? { previousSummaryMessage: summaryMessage } : {}),
          });
          if (planned.viewTokens + overheadTokens > this.config.maxInputTokens) {
            throw new Error(
              'Context budget exceeded by protected instructions or the current turn; history has been preserved.'
            );
          }
          if (planned.compacted) {
            requestView = planned.requestView;
            summaryMessage = planned.summaryMessage;
            // Full rebuild from the canonical view. A count-based in-place
            // splice is UNSOUND here: protected-user relocation makes the
            // omission non-contiguous, multi-part tool messages project 1:N,
            // and a leading transcript system shifts every index. The
            // placeholder system absorbs the projection's systemPrompt slot
            // so every REAL system (prior summaries included) stays in the
            // messages; the original transcript system is dropped from the
            // rebuild — the loop's assembled systemPrompt already carries it.
            const rebuilt = projectHistoryToPiContext(
              [
                { role: 'system', content: PER_REQUEST_COMPACT_PLACEHOLDER },
                ...requestView,
              ],
              this.config.model
            );
            transcript.splice(
              0,
              transcript.length,
              ...rebuilt.messages.filter(
                message => !(message.role === 'system' && message.content === transcriptSystemText)
              )
            );
            requestSystemPrompt = assembleRequestSystemPrompt([
              { slot: 'persona', text: personaPrompt },
              { slot: 'planPrompt', text: this.config.systemPrompt },
              { slot: 'transcriptSystem', text: transcriptSystemText },
            ]).prompt;
            logger.event({
              level: 'info',
              outcome: 'succeeded',
              event: 'llm.context.compacted',
              message: 'Pi tool turn request view compacted mid-turn.',
              data: {
                omittedCount: planned.omittedCount,
                viewTokens: planned.viewTokens,
                durationMs: Date.now() - compactionStartedAt,
              },
            });
          }
        }
        // Snapshot at call time = exactly what this step sends: the request
        // view (compacted basis included) plus any recovery note that has
        // not been flushed into it yet.
        sentSnapshots.push([...requestView, ...pendingNotes]);
        return this.modelCall(this.config, {
          systemPrompt: requestSystemPrompt,
          messages: context.messages,
          tools: piTools,
          ...(signal ? { signal } : {}),
          ...(typeof this.config.maxOutputTokens === 'number'
            ? { maxTokens: this.config.maxOutputTokens }
            : {}),
          onRecoveryNote: noteText => {
            pendingNotes.push({ role: 'user', content: noteText });
          },
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
        // Flushed notes are now part of the stored trajectory (runner parity).
        if (pendingNotes.length > 0) {
          this.history = [...this.history, ...pendingNotes];
          requestView = [...requestView, ...pendingNotes];
          pendingNotes.length = 0;
        }
        lastStepUsage = mapBuckets(step.usage);
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
        const assistantEntry: ModelMessage = { role: 'assistant', content: assistantParts };
        this.history = [...this.history, assistantEntry];
        requestView = [...requestView, assistantEntry];

        const stepUsage: AgentUsage = mapBuckets(step.usage);
        input.onInference?.({
          messages: sentSnapshots.at(-1) ?? requestView,
          systemPrompt,
          content: assistantParts,
          finishReason: step.toolCalls.length > 0 ? 'tool-calls' : 'stop',
          usage: stepUsage,
        });
      } else if (event.type === 'tool_start') {
        // Terminal tools (handoff) stay off the execution-event surface: the
        // driver projects its own handoff event from the outcome (runner
        // TERMINAL_TOOL_NAMES parity). NOTE: no `continue` — the loop's
        // iterator advance is this while-body's last statement, and skipping
        // it would re-process the same event forever.
        if (!TERMINAL_TOOL_NAMES.has(event.call.name)) {
          yield {
            event: 'step',
            step: {
              type: 'tool_execution_start',
              toolCallId: event.call.id,
              toolName: event.call.name,
              input: event.call.arguments,
            },
          };
        }
      } else {
        const isError = toolExecutionIsError(event.output);
        toolCallResults.push({
          toolName: event.call.name,
          args: event.call.arguments,
          result: event.output,
        });
        if (!TERMINAL_TOOL_NAMES.has(event.call.name)) {
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
        } else if (event.call.name === 'handoff') {
          // The runner yields a handoff step for the terminal call — the
          // driver projects its own handoff UI event from it (parity).
          const args = event.call.arguments as Record<string, unknown>;
          yield {
            event: 'step',
            step: {
              type: 'handoff',
              summary: typeof args.summary === 'string' ? args.summary : '',
              nextSteps: typeof args.next_steps === 'string' ? args.next_steps : '',
              reason: typeof args.reason === 'string' ? args.reason : 'other',
            },
          };
        }
        const toolResultEntry: ModelMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: event.call.id,
              toolName: event.call.name,
              output: event.output as ToolResultPart['output'],
            },
          ],
        };
        this.history = [...this.history, toolResultEntry];
        requestView = [...requestView, toolResultEntry];
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

    const awaitingApproval = outcome.status === 'awaiting-approval';
    if (awaitingApproval && pendingApprovalRequests.length === 0) {
      throw new Error('Pi tool turn paused for approval without any recorded approval request.');
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
    if (awaitingApproval) {
      // The driver's done branch persists the batch (registerApprovalBatch)
      // and ends the turn awaiting-approval — the harness only reports.
      yield {
        event: 'step',
        step: { type: 'approval_request', requests: pendingApprovalRequests },
      };
    }
    const output: TurnOutput = {
      text,
      usage,
      // The LAST step's billed input — the real context size the model last
      // saw (the renderer's occupancy signal), not the multi-step sum.
      ...(lastStepUsage && lastStepUsage.inputTokens > 0
        ? { lastStepInputTokens: lastStepUsage.inputTokens }
        : {}),
      perf,
      ...(toolSchemaTokens ? { toolSchemaTokens } : {}),
      requiresApproval: awaitingApproval,
      finishReason: awaitingApproval ? undefined : finishReason,
      ...(toolCallResults.length > 0 ? { toolCalls: toolCallResults } : {}),
      ...(awaitingApproval ? { toolApprovalRequests: pendingApprovalRequests } : {}),
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

const toolOutputText = (output: unknown): string => {
  if (output !== null && typeof output === 'object' && 'type' in output) {
    const o = output as { type: string; value?: unknown; reason?: unknown };
    if (o.type === 'execution-denied') {
      return typeof o.reason === 'string' ? o.reason : 'Tool execution was denied';
    }
  }
  return output !== null && typeof output === 'object' && 'value' in output
    ? String((output as { value: unknown }).value)
    : 'Tool execution failed';
};
