import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';

import { createLogger } from '@iki/backend/logger';
import { RefusalError, getErrorMessage, isRetryableError } from '@iki/backend/utils/errors';
import { isLangfuseEnabled, tracePiGeneration } from '@iki/backend/observability/langfuse';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import {
  appendUserPromptToHistory,
  cloneModelMessages,
  type ModelMessage,
} from '@iki/backend/message/model_history';
import {
  resolvePersonaPrompt,
  getProviderConfig,
  resolvePiModelCapability,
  resolveProviderApi,
} from '../../provider/llm/factory';
import {
  buildPiModel,
  callPiChat,
  projectHistoryToPiContext,
  projectUsageToIki,
} from '../../provider/llm/pi_adapter';
import { preparePiTurnHistory } from './pi_turn_budget';
import type { AgentTurnPerf, AgentUsage } from '../types';
import type { HarnessConfig, TurnEvent, TurnInput, TurnOutput } from '../harness/harness_types';

const logger = createLogger({ module: 'pi_text_turn_harness' });

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
  const capability = resolvePiModelCapability({
    providerType: config.providerType,
    ...(config.providerId ? { providerId: config.providerId } : {}),
    modelId: config.model,
  });
  const model = buildPiModel({
    id: config.model,
    providerType: config.providerType,
    baseUrl: provider.baseURL,

    api: resolveProviderApi(config.providerType, provider),

    contextWindow: capability?.contextWindow ?? 128000,
    maxTokens: config.maxOutputTokens ?? capability?.maxTokens ?? 4096,
    ...(capability?.input ? { input: capability.input } : {}),
    ...(capability?.cost ? { cost: capability.cost } : {}),
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
      ...(typeof this.config.maxInputTokens === 'number'
        ? { maxInputTokens: this.config.maxInputTokens }
        : {}),
      ...(this.config.threadId ? { threadId: this.config.threadId } : {}),
      ...(signal ? { signal } : {}),
    });

    const projected = projectHistoryToPiContext(requestHistory, this.config.model, this.config.providerType);

    const { prompt: systemPrompt } = assembleRequestSystemPrompt([
      { slot: 'persona', text: personaPrompt },
      { slot: 'planPrompt', text: this.config.systemPrompt },
      { slot: 'transcriptSystem', text: projected.systemPrompt },
    ]);

    const turnStartedAt = Date.now();
    let llmMs = 0;
    let firstDeltaMs: number | null = null;
    let streamedText = '';

    const storedTrack = this.history;
    const recoveryNotes: ModelMessage[] = [];

    for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      signal?.throwIfAborted();
      const attemptStartedAt = Date.now();
      const attemptHistory = [...requestHistory, ...recoveryNotes];
      const attemptProjection = projectHistoryToPiContext(attemptHistory, this.config.model, this.config.providerType);
      const attemptRequest = {
        systemPrompt,
        messages: attemptProjection.messages,
        ...(signal ? { signal } : {}),
        ...(typeof this.config.maxOutputTokens === 'number'
          ? { maxTokens: this.config.maxOutputTokens }
          : {}),
      };
      const eventStream = this.modelCall(this.config, attemptRequest);

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

        if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
        throw error;
      }
      llmMs += Math.max(0, Date.now() - attemptStartedAt);

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

        failure = new RefusalError(
          'Model returned an empty response with no tool calls',
          final.stopReason,
          undefined
        );
      }

      this.traceCall(attemptRequest.maxTokens, final, failure);
      if (!failure) {
        yield* this.finishTurn(input, final, finalText, {
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

    throw new Error('Pi text turn exhausted all retry attempts');
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }

  private traceCall(maxTokens: number | undefined, final: AssistantMessage, failure?: Error): void {
    if (!isLangfuseEnabled()) return;

    void tracePiGeneration(
      {
        name: 'pi.text.turn',
        model: this.config.model,
        provider: this.config.providerType,
        ...(this.config.threadId ? { sessionId: this.config.threadId } : {}),
        ...(typeof maxTokens === 'number' ? { modelParameters: { maxTokens } } : {}),
      },
      onSettle => {
        onSettle({
          output: final.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map(block => block.text)
            .join(''),
          usageDetails: {
            input: final.usage?.input ?? 0,
            output: final.usage?.output ?? 0,
            total: final.usage?.totalTokens ?? 0,
          },
          costUsd: final.usage?.cost?.total ?? 0,
          ...(failure ? { errorMessage: getErrorMessage(failure) } : {}),
        });
        return Promise.resolve();
      }
    ).catch(error => {
      logger.event({
        level: 'warn',
        event: 'langfuse.span.failed',
        outcome: 'degraded',
        message: 'Failed to record the Pi generation observation.',
        error,
      });
    });
  }

  private buildTurnHistory(history: ModelMessage[] | undefined, prompt: string): ModelMessage[] {
    const base = cloneModelMessages(history);

    if (!prompt.trim() && base.length > 0) return base;
    return appendUserPromptToHistory(base, prompt);
  }

  private *finishTurn(
    input: TurnInput,
    final: AssistantMessage,
    text: string,
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
