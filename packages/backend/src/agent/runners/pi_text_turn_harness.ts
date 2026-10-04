import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';
import type { ModelMessage } from 'ai';

import { createLogger } from '@iki/backend/logger';
import { RefusalError, getErrorMessage, isRetryableError } from '@iki/backend/utils/errors';
import { appendUserPromptToHistory, cloneModelMessages } from '../../provider/ai_sdk_runtime';
import { getFullSystemPrompt, getProviderConfig } from '../../provider/llm/factory';
import {
  buildPiModel,
  callPiChat,
  projectHistoryToPiContext,
  projectUsageToIki,
} from '../../provider/llm/pi_adapter';
import { generateThreadSummary } from '../../runtimes/thread_summary';
import {
  autoCompactHistory,
  estimateMessageTokens,
  estimateTextTokens,
} from '../context_budget';
import type { AgentTurnPerf, AgentUsage } from '../types';
import type { HarnessConfig, TurnEvent, TurnInput, TurnOutput } from '../harness/harness_types';

const logger = createLogger({ module: 'pi_text_turn_harness' });

/**
 * The text-only streaming turn harness over the Pi supply layer (switch item
 * 2c, issue #110). Routed by session_loop for turns whose plan has
 * `enableTools: false` on a Pi-eligible provider; tool turns, approval
 * resume and handoff chains stay on AgentHarness until their own switch
 * items.
 *
 * Contract parity with AgentHarness/SimpleAgentRunner for the text subset:
 * - one model call per attempt; no tools are resolved and a non-empty
 *   `toolsOverride` is refused (routing keeps this surface text-only);
 * - the request system prompt is the same three-part join the factory's Pi
 *   branch uses: persona (getFullSystemPrompt — identity, date/timezone, OS,
 *   cwd), the plan's system prompt, then the transcript's own leading system
 *   message;
 * - history stays ModelMessage-shaped end to end: the prompt is appended by
 *   the same helper the AI SDK runner uses, the response is appended as an
 *   assistant message (thinking → reasoning parts), and `getHistory` returns
 *   a clone — run-row sync, persistence and recovery are untouched;
 * - the input budget is enforced by the same owners as the AI SDK
 *   prepareStep path (autoCompactHistory + generateThreadSummary). Compaction
 *   runs once per turn before the attempts; without a cache prefix the
 *   summarizer falls back to its standalone call — the same accepted
 *   degradation as custom-model runs;
 * - retry parity: transient failures and refusals (empty response,
 *   content-filter) are retried with the runner's bounds (3 retries, the
 *   shared isRetryableError classifier, exponential backoff) but only while
 *   NOTHING has been streamed — a delta already shown is never re-shown. The
 *   recovery note joins the stored history on success, exactly like the
 *   runner's;
 * - an empty response with no tool calls is a RefusalError, matching the
 *   runner; a provider content-filter finish reason maps to the same
 *   RefusalError shape;
 * - failures follow the driver's classification contract: provider errors
 *   throw (Pi delivers them as a RESOLVED error message, never a rejection —
 *   the stopReason must be checked), aborts throw DOMException('AbortError');
 * - `input.onInference` records the request facts onto the run row in the AI
 *   SDK part vocabulary (reasoning parts, not Pi thinking blocks) so
 *   downstream record consumers (ATIF export) keep reading one vocabulary.
 *
 * Live text/thinking deltas stream as message_update steps — shown ⊆
 * committed stays downstream, in the TurnDriver's buffer gate.
 */

/** The narrow call surface this harness consumes. The harness hands the
 * harness config plus the already-projected request; the production
 * implementation resolves the provider row, builds the Pi model and calls
 * the adapter — tests hand a scripted double that never touches the
 * provider database. */
export type PiTextModelCall = (
  config: HarnessConfig,
  request: {
    systemPrompt: string;
    messages: PiMessage[];
    signal?: AbortSignal;
    maxTokens?: number;
  }
) => ReturnType<typeof callPiChat>;

const defaultPiTextModelCall: PiTextModelCall = (config, request) => {
  const provider = getProviderConfig(config.providerType, config.providerId);
  const model = buildPiModel({
    id: config.model,
    baseUrl: provider.baseURL,
    // Same convention as the factory's Pi branch: catalog-window resolution
    // would be a network dependency; the input budget is enforced by the
    // harness and the output cap rides the call options.
    contextWindow: 128000,
    maxTokens: config.maxOutputTokens ?? 4096,
  });
  return callPiChat(
    model,
    { systemPrompt: request.systemPrompt, messages: request.messages },
    {
      apiKey: provider.apiKey,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
    }
  );
};

const ZERO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  estimatedCostUsd: 0,
};

// The runner's retry bounds (simple_agent_runner): 3 retries, exponential
// backoff capped at 30s, only while nothing has been emitted.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const CONTENT_FILTER_PATTERN = /content_filter/i;

export class PiTextTurnHarness {
  private readonly config: HarnessConfig;
  private readonly modelCall: PiTextModelCall;
  private history: ModelMessage[] = [];

  constructor(config: HarnessConfig, overrides?: { modelCall?: PiTextModelCall }) {
    this.config = config;
    this.modelCall = overrides?.modelCall ?? defaultPiTextModelCall;
  }

  async *turn(input: TurnInput): AsyncGenerator<TurnEvent, void> {
    const signal = input.abortSignal;
    signal?.throwIfAborted();
    if (input.toolsOverride?.length) {
      throw new Error('PiTextTurnHarness is text-only; toolsOverride is not supported.');
    }

    this.history = this.buildTurnHistory(input.history, input.prompt);

    // Input budget — the AI SDK prepareStep semantics, same owners: compact
    // at tool-exchange boundaries, summarize the omitted prefix, then refuse
    // if protected instructions or the current turn alone exceed the budget.
    // Compaction is request-scoped; the stored history keeps the full text.
    const personaPrompt = getFullSystemPrompt(this.config.providerType, this.config.providerId);
    const firstTranscriptSystem = this.history.find(
      (message): message is Extract<ModelMessage, { role: 'system' }> => message.role === 'system'
    );
    const transcriptSystemText =
      typeof firstTranscriptSystem?.content === 'string' ? firstTranscriptSystem.content : '';
    const overhead = estimateTextTokens(
      [personaPrompt, this.config.systemPrompt, transcriptSystemText].filter(Boolean).join('\n\n')
    );
    let requestHistory = this.history;
    if (this.config.maxInputTokens) {
      const planned = autoCompactHistory({
        history: requestHistory,
        maxInputTokens: this.config.maxInputTokens - overhead,
      });
      if (planned.compacted) {
        const summary = await generateThreadSummary({
          ...(this.config.threadId ? { threadId: this.config.threadId } : {}),
          ...(signal ? { abortSignal: signal } : {}),
          messages: planned.omitted.map(message => ({
            role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
            content:
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify({ role: message.role, content: message.content }),
          })),
        });
        if (!summary) {
          throw new Error('Context compaction failed; original history has been preserved.');
        }
        const summaryMessage: ModelMessage = {
          role: 'system',
          content: `Earlier conversation summary:\n${summary.summary}`,
        };
        requestHistory = [
          ...planned.history.filter(message => message.role === 'system'),
          summaryMessage,
          ...planned.history.filter(message => message.role !== 'system'),
        ];
      }
      if (
        requestHistory.reduce((sum, message) => sum + estimateMessageTokens(message), overhead) >
        this.config.maxInputTokens
      ) {
        throw new Error(
          'Context budget exceeded by protected instructions or the current turn; history has been preserved.'
        );
      }
    }

    const projected = projectHistoryToPiContext(requestHistory, this.config.model);
    // Persona first, then the plan's system prompt, then the transcript's own
    // leading system message — the same join order the factory's Pi branch
    // uses.
    const systemPrompt = [personaPrompt, this.config.systemPrompt, projected.systemPrompt]
      .filter(value => value.trim().length > 0)
      .join('\n\n');

    const turnStartedAt = Date.now();
    let llmMs = 0;
    let firstDeltaMs: number | null = null;
    let streamedText = '';
    // Retry-track notes: they ride the requests immediately and join the
    // STORED (uncompacted) history only on success — a failed recovery
    // attempt leaves no note behind, and compaction never touches stored
    // history (runner parity).
    const storedTrack = this.history;
    const recoveryNotes: ModelMessage[] = [];

    for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      signal?.throwIfAborted();
      const attemptStartedAt = Date.now();
      const attemptHistory = [...requestHistory, ...recoveryNotes];
      const attemptProjection = projectHistoryToPiContext(attemptHistory, this.config.model);
      const eventStream = this.modelCall(this.config, {
        systemPrompt,
        messages: attemptProjection.messages,
        ...(signal ? { signal } : {}),
        ...(typeof this.config.maxOutputTokens === 'number'
          ? { maxTokens: this.config.maxOutputTokens }
          : {}),
      });

      let final: AssistantMessage;
      try {
        const resultPromise = eventStream.result();
        for await (const event of eventStream) {
          if (event.type === 'text_delta' && event.delta) {
            if (firstDeltaMs === null) firstDeltaMs = Date.now() - attemptStartedAt;
            streamedText += event.delta;
            yield {
              event: 'step',
              step: { type: 'message_update', text: event.delta, kind: 'text' },
            };
            continue;
          }
          if (event.type === 'thinking_delta' && event.delta) {
            if (firstDeltaMs === null) firstDeltaMs = Date.now() - attemptStartedAt;
            yield {
              event: 'step',
              step: { type: 'message_update', text: event.delta, kind: 'reasoning' },
            };
            continue;
          }
        }
        final = await resultPromise;
      } catch (error) {
        // The Pi stream itself does not throw (failures arrive as events); an
        // iterator throw here is a teardown race — classify it like one.
        if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
        throw error;
      }
      llmMs += Math.max(0, Date.now() - attemptStartedAt);

      // Pi resolves provider failures into a result message — never a
      // rejection. The stopReason is the failure surface.
      if (final.stopReason === 'aborted') {
        throw new DOMException(final.errorMessage || 'Run cancelled', 'AbortError');
      }

      const finalText =
        streamedText ||
        final.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('');

      let failure: Error | undefined;
      if (final.stopReason === 'error') {
        failure = CONTENT_FILTER_PATTERN.test(final.errorMessage ?? '')
          ? new RefusalError(
              'Model response was blocked by content filter',
              'content-filter',
              streamedText || undefined
            )
          : new Error(final.errorMessage || 'Provider returned an error stop reason');
      } else if (!finalText.trim()) {
        // Soft refusal, matching the AI SDK runner: a text turn that produces
        // neither text nor tool calls fails instead of committing an empty
        // reply.
        failure = new RefusalError(
          'Model returned an empty response with no tool calls',
          final.stopReason,
          undefined
        );
      }
      if (!failure) {
        yield* this.finishTurn(input, final, finalText, systemPrompt, {
          requestHistory: attemptHistory,
          storedTrack,
          recoveryNotes,
        }, {
          llmMs,
          firstDeltaMs,
          turnStartedAt,
        });
        return;
      }

      const canRetry =
        attempt < RETRY_MAX_ATTEMPTS && !signal?.aborted && !streamedText && isRetryableError(failure);
      if (!canRetry) {
        logger.event({
          level: 'error',
          event: 'llm.turn.failed',
          outcome: 'failed',
          message: `Pi text turn failed for provider "${this.config.providerType}" model "${this.config.model}".`,
          data: {
            providerType: this.config.providerType,
            model: this.config.model,
            attempt,
            ...(streamedText ? { partialText: true } : {}),
            errorMessage: getErrorMessage(failure),
          },
        });
        throw failure;
      }

      const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), RETRY_MAX_DELAY_MS);
      logger.event({
        level: 'warn',
        event: 'llm.turn.retry',
        outcome: 'started',
        message: `Pi text turn failed, retrying (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}) after ${delay}ms`,
        data: { providerType: this.config.providerType, model: this.config.model, errorMessage: getErrorMessage(failure) },
      });
      await sleep(delay);
      const recoveryNote =
        failure instanceof RefusalError
          ? 'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.'
          : `Your last attempt encountered an error: ${getErrorMessage(failure)}. Please try a different approach or simplify your response to avoid this issue.`;
      recoveryNotes.push(
        appendUserPromptToHistory(
          [],
          `${recoveryNote}\n\n---\nContinue with the original task.`
        )[0]
      );
    }

    // Unreachable: the loop returns on success or throws on the last attempt.
    throw new Error('Pi text turn exhausted all retry attempts');
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

  /** Success path: append the response to history, record the inference
   * fact, and yield turn_end + done. Split out so the retry loop reads flat. */
  private *finishTurn(
    input: TurnInput,
    final: AssistantMessage,
    text: string,
    systemPrompt: string,
    tracks: {
      requestHistory: ModelMessage[];
      storedTrack: ModelMessage[];
      recoveryNotes: ModelMessage[];
    },
    timing: { llmMs: number; firstDeltaMs: number | null; turnStartedAt: number }
  ): Generator<TurnEvent, void> {
    const mappedUsage: AgentUsage = final.usage
      ? {
          ...projectUsageToIki(final.usage),
          // Catalog cost rates are not wired into the Pi model yet (tracked
          // since switch item 1) — the provider-computed cost rides along.
          estimatedCostUsd: final.usage.cost.total,
        }
      : ZERO_USAGE;
    const perf: AgentTurnPerf = {
      llmMs: timing.llmMs,
      toolMs: 0,
      firstTokenMs: timing.firstDeltaMs ?? 0,
      firstTokenSamples: timing.firstDeltaMs === null ? 0 : 1,
      toolCalls: 0,
      steps: 1,
    };

    // The stored history is the UNCOMPACTED turn history plus any recovery
    // notes, then the response as ModelMessage parts (thinking → reasoning,
    // in content order) — the shape the AI SDK response messages carry.
    const responseParts: Array<
      { type: 'text'; text: string } | { type: 'reasoning'; text: string }
    > = [];
    for (const block of final.content) {
      if (block.type === 'text' && block.text) {
        responseParts.push({ type: 'text', text: block.text });
      } else if (block.type === 'thinking' && block.thinking) {
        responseParts.push({ type: 'reasoning', text: block.thinking });
      }
    }
    this.history = [...tracks.storedTrack, ...tracks.recoveryNotes, { role: 'assistant', content: responseParts }];

    input.onInference?.({
      messages: tracks.requestHistory,
      systemPrompt,
      content: responseParts,
      finishReason: final.stopReason,
      usage: mappedUsage,
    });

    yield {
      event: 'step',
      step: { type: 'turn_end', outcome: 'completed', text, usage: mappedUsage },
    };
    const output: TurnOutput = {
      text,
      usage: mappedUsage,
      ...(mappedUsage.inputTokens > 0 ? { lastStepInputTokens: mappedUsage.inputTokens } : {}),
      perf,
      requiresApproval: false,
      finishReason: final.stopReason,
    };
    yield { event: 'done', output };
  }
}
