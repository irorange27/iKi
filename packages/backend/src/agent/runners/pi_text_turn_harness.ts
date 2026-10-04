import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';
import type { ModelMessage } from 'ai';

import { createLogger } from '@iki/backend/logger';
import { RefusalError } from '@iki/backend/utils/errors';
import { appendUserPromptToHistory, cloneModelMessages } from '../../provider/ai_sdk_runtime';
import { getProviderConfig } from '../../provider/llm/factory';
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
 * Contract parity with AgentHarness for the text subset:
 * - one model call per turn; no tools are resolved and `toolsOverride` is not
 *   honored (routing keeps this surface text-only);
 * - history stays ModelMessage-shaped end to end: the prompt is appended by
 *   the same helper the AI SDK runner uses, the response is appended as an
 *   assistant message (thinking → reasoning parts), and `getHistory` returns
 *   a clone — run-row sync, persistence and recovery are untouched;
 * - the input budget is enforced by the same owners as the AI SDK
 *   prepareStep path (autoCompactHistory + generateThreadSummary). Without a
 *   cache prefix the summarizer falls back to its standalone call — the same
 *   accepted degradation as custom-model runs;
 * - an empty response with no tool calls is a RefusalError, matching the
 *   runner;
 * - failures follow the driver's classification contract: provider errors
 *   throw (Pi delivers them as a RESOLVED error message, never a rejection —
 *   the stopReason must be checked), aborts throw DOMException('AbortError');
 * - `input.onInference` records the request facts onto the run row exactly
 *   like the AI SDK runner's onModelStep does.
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
    const startedAt = Date.now();
    let firstDeltaMs: number | null = null;

    this.history = this.buildTurnHistory(input.history, input.prompt);
    let requestHistory = this.history;

    // Input budget — the AI SDK prepareStep semantics, same owners: compact
    // at tool-exchange boundaries, summarize the omitted prefix, then refuse
    // if protected instructions or the current turn alone exceed the budget.
    // Compaction is request-scoped; the stored history keeps the full text.
    const overhead = estimateTextTokens(this.config.systemPrompt);
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
    // Config system first, then the transcript's own leading system message —
    // the same join order the factory's Pi branch uses.
    const systemPrompt = [this.config.systemPrompt, projected.systemPrompt]
      .filter(value => value.trim().length > 0)
      .join('\n\n');

    const eventStream = this.modelCall(this.config, {
      systemPrompt,
      messages: projected.messages,
      ...(signal ? { signal } : {}),
      ...(typeof this.config.maxOutputTokens === 'number'
        ? { maxTokens: this.config.maxOutputTokens }
        : {}),
    });

    let streamedText = '';
    const resultPromise = eventStream.result();
    try {
      for await (const event of eventStream) {
        if (event.type === 'text_delta' && event.delta) {
          if (firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt;
          streamedText += event.delta;
          yield {
            event: 'step',
            step: { type: 'message_update', text: event.delta, kind: 'text' },
          };
          continue;
        }
        if (event.type === 'thinking_delta' && event.delta) {
          if (firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt;
          yield {
            event: 'step',
            step: { type: 'message_update', text: event.delta, kind: 'reasoning' },
          };
          continue;
        }
      }
    } catch (error) {
      // The Pi stream itself does not throw (failures arrive as events); an
      // iterator throw here is a teardown race — classify it like one.
      if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
      throw error;
    }
    const final = await resultPromise;

    // Pi resolves provider failures into a result message — never a
    // rejection. The stopReason is the failure surface.
    if (final.stopReason === 'aborted') {
      throw new DOMException(final.errorMessage || 'Run cancelled', 'AbortError');
    }
    if (final.stopReason === 'error') {
      logger.event({
        level: 'error',
        event: 'llm.turn.failed',
        outcome: 'failed',
        message: `Pi text turn failed for provider "${this.config.providerType}" model "${this.config.model}".`,
        data: {
          providerType: this.config.providerType,
          model: this.config.model,
          errorMessage: final.errorMessage,
        },
      });
      throw new Error(final.errorMessage || 'Provider returned an error stop reason');
    }

    const text =
      streamedText ||
      final.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('');

    // Soft refusal, matching the AI SDK runner: a text turn that produces
    // neither text nor tool calls fails instead of committing an empty reply.
    if (!text.trim()) {
      throw new RefusalError(
        'Model returned an empty response with no tool calls',
        final.stopReason,
        undefined
      );
    }

    const mappedUsage: AgentUsage = final.usage
      ? {
          ...projectUsageToIki(final.usage),
          // Catalog cost rates are not wired into the Pi model yet (tracked
          // since switch item 1) — the provider-computed cost rides along.
          estimatedCostUsd: final.usage.cost.total,
        }
      : ZERO_USAGE;
    const perf: AgentTurnPerf = {
      llmMs: Math.max(0, Date.now() - startedAt),
      toolMs: 0,
      firstTokenMs: firstDeltaMs ?? 0,
      firstTokenSamples: firstDeltaMs === null ? 0 : 1,
      toolCalls: 0,
      steps: 1,
    };

    // The response joins history as ModelMessage parts, thinking → reasoning,
    // in content order — the same shape the AI SDK response messages carry.
    const responseParts: Array<{ type: 'text'; text: string } | { type: 'reasoning'; text: string }> = [];
    for (const block of final.content) {
      if (block.type === 'text' && block.text) {
        responseParts.push({ type: 'text', text: block.text });
      } else if (block.type === 'thinking' && block.thinking) {
        responseParts.push({ type: 'reasoning', text: block.thinking });
      }
    }
    this.history = [...this.history, { role: 'assistant', content: responseParts }];

    input.onInference?.({
      messages: requestHistory,
      systemPrompt,
      content: final.content,
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
