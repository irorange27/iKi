import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';

import { createLogger } from '@iki/backend/logger';
import {
  getErrorMessage,
  isContextOverflowError,
  isRetryableError,
  RefusalError,
} from '@iki/backend/utils/errors';
import {
  CONTENT_FILTER_PATTERN,
  PI_RETRY_MAX_ATTEMPTS,
  contentFilterRefusal,
  piRetryDelayMs,
  providerErrorStop,
  recoveryNoteFor,
  sleep,
} from './pi_retry';
import type { PiLoopDelta } from './pi_agent_loop';
import type { HarnessConfig } from '../harness/harness_types';
import { shouldUseCacheRetention } from '../../provider/llm/pi_adapter';
import { buildPiModel, callPiChat, projectToolsToPiTools } from '../../provider/llm/pi_adapter';
import {
  getProviderConfig,
  resolvePiModelCapability,
  resolveProviderApi,
} from '../../provider/llm/factory';

const logger = createLogger({ module: 'pi_tool_model_call' });

type PiStreamEvent = { type: 'text_delta' | 'thinking_delta'; delta: string };

export type PiToolModelCall = (
  config: HarnessConfig,
  request: {
    systemPrompt: string;

    messages: PiMessage[];
    tools?: ReturnType<typeof projectToolsToPiTools>;
    signal?: AbortSignal;
    maxTokens?: number;

    onRecoveryNote?: (noteText: string) => void;

    onContextOverflow?: () => Promise<void>;
  }
) => { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> };

export const withPiRetry = (
  attempt: () => { stream: AsyncIterable<PiStreamEvent>; final: Promise<AssistantMessage> },
  request: { messages: PiMessage[]; signal?: AbortSignal },
  onRecoveryNote?: (noteText: string) => void,

  onContextOverflow?: () => Promise<void>
): { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> } => {
  const queue: PiLoopDelta[] = [];
  let notify: (() => void) | undefined;
  let done = false;
  let overflowRetried = false;
  const pushDelta = (delta: PiLoopDelta) => {
    queue.push(delta);
    notify?.();
  };
  const waitDelta = () =>
    new Promise<void>(resolve => {
      notify = resolve;
    });

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
            ? contentFilterRefusal()
            : providerErrorStop(final.errorMessage);

          if (
            isContextOverflowError(final.errorMessage) &&
            onContextOverflow &&
            !overflowRetried &&
            !streamed &&
            !request.signal?.aborted
          ) {
            overflowRetried = true;
            attemptIndex = 0;
            logger.event({
              level: 'warn',
              event: 'llm.turn.retry',
              outcome: 'started',
              message:
                'Provider rejected the request for context length; compacted and retrying once.',
              data: {},
            });
            await onContextOverflow();
            continue;
          }
          if (
            attemptIndex < PI_RETRY_MAX_ATTEMPTS &&
            !streamed &&
            !request.signal?.aborted &&
            isRetryableError(failure)
          ) {
            attemptIndex += 1;
            await sleep(piRetryDelayMs(attemptIndex - 1));
            const note = recoveryNoteFor(failure);

            request.messages.push({ role: 'user', content: note, timestamp: Date.now() });
            onRecoveryNote?.(note);
            logger.event({
              level: 'warn',
              event: 'llm.turn.retry',
              outcome: 'started',
              message: `Pi tool turn step failed, retrying (attempt ${attemptIndex}/${PI_RETRY_MAX_ATTEMPTS})`,
              data: { errorMessage: getErrorMessage(failure) },
            });
            continue;
          }

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

export const defaultPiToolModelCall: PiToolModelCall = (config, request) => {
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
  return withPiRetry(
    () => {
      const stream = callPiChat(
        model,
        { systemPrompt: request.systemPrompt, messages: request.messages, tools: request.tools },
        {
          apiKey: provider.apiKey,
          ...(request.signal ? { signal: request.signal } : {}),
          ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
          ...(shouldUseCacheRetention(model) ? { cacheRetention: 'short' } : {}),
        }
      );
      return {
        stream: stream as unknown as AsyncIterable<PiStreamEvent>,
        final: stream.result(),
      };
    },
    request,
    request.onRecoveryNote,
    request.onContextOverflow
  );
};
