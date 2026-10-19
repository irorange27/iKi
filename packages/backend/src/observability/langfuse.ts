import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  startActiveObservation,
  setActiveTraceIO,
  propagateAttributes,
  type LangfuseAgent,
  type LangfuseGeneration,
} from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { createLogger } from '@iki/backend/logger';

const logger = createLogger({ module: 'langfuse' });

let sdk: NodeSDK | null = null;
let processor: LangfuseSpanProcessor | null = null;

const hasLangfuseEnv = (): boolean =>
  Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

export const isLangfuseEnabled = (): boolean => sdk !== null;

export const initLangfuseTracing = (): void => {
  if (sdk) return;
  if (!hasLangfuseEnv()) {
    logger.event({
      level: 'info',
      event: 'langfuse.init.skip',
      message: 'LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled',
    });
    return;
  }

  // ponytail: @langfuse/otel reads keys from env at construction time; no explicit config needed.
  processor = new LangfuseSpanProcessor();
  sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();

  logger.event({
    level: 'info',
    event: 'langfuse.init.ok',
    message: 'Langfuse tracing initialized',
    data: { baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com' },
  });
};

export const shutdownLangfuseTracing = async (): Promise<void> => {
  if (!sdk) return;
  try {
    await processor?.forceFlush();
    await sdk.shutdown();
  } catch (error) {
    logger.event({
      level: 'warn',
      event: 'langfuse.shutdown.failed',
      error: error as Error,
    });
  } finally {
    sdk = null;
    processor = null;
  }
};

export type LangfuseMetadataValue = string | number | boolean;

export type LangfuseTelemetry = {
  isEnabled: true;
  functionId: string;
  metadata?: Record<string, LangfuseMetadataValue>;
};

/**
 * Build the `experimental_telemetry` payload for an AI SDK call.
 * Returns `undefined` when tracing is off, so callers can spread it safely.
 *
 * `metadata.sessionId` groups traces in the Langfuse Sessions view;
 * pass the thread/conversation id whenever you have one.
 */
export const langfuseTelemetry = (
  functionId: string,
  metadata?: Record<string, unknown>,
): LangfuseTelemetry | undefined => {
  if (!isLangfuseEnabled()) return undefined;
  const filtered: Record<string, LangfuseMetadataValue> = {};
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        filtered[k] = v;
      }
    }
  }
  return {
    isEnabled: true,
    functionId,
    ...(Object.keys(filtered).length > 0 ? { metadata: filtered } : {}),
  };
};

/**
 * Wrap a chat turn so its nested AI SDK spans (agent.stream, chat.generate, …)
 * become children of one `chat.turn` agent observation. The trace's input/output
 * is set from the user prompt and final answer; sessionId is set on the trace.
 *
 * No-op (just runs the callback) when tracing is disabled.
 */
export const traceChatTurn = async <T>(
  params: {
    threadId?: string;
    prompt: string;
    provider?: string;
    model?: string;
  },
  run: () => Promise<T>,
  getOutput?: (result: T) => string | undefined
): Promise<T> => {
  if (!isLangfuseEnabled()) return run();

  return startActiveObservation(
    'chat.turn',
    async (agent: LangfuseAgent) => {
      agent.update({ input: params.prompt });
      setActiveTraceIO({ input: params.prompt });

      return propagateAttributes(
        {
          traceName: 'chat.turn',
          ...(params.threadId ? { sessionId: params.threadId } : {}),
          metadata: {
            ...(params.provider ? { provider: params.provider } : {}),
            ...(params.model ? { model: params.model } : {}),
          },
        },
        async () => {
          const result = await run();
          const output = getOutput?.(result);
          if (output !== undefined) {
            agent.update({ output });
            setActiveTraceIO({ output });
          }
          return result;
        }
      );
    },
    { asType: 'agent' }
  );
};

/**
 * Wrap ONE model call made through the Pi supply layer as a Langfuse
 * `generation` observation — the Pi-path counterpart of the AI SDK's
 * `experimental_telemetry`. Pi is a bare stream with no telemetry hook, so
 * the span is created by hand and its fields updated when the call settles.
 *
 * Why a generation and not a span: generations carry model/usage/cost in
 * Langfuse's cost views, which is exactly what a per-turn supply switch
 * needs to compare against the AI SDK's own generated spans.
 *
 * The trace tree comes from the caller: inside `traceChatTurn`'s active
 * `chat.turn` agent span this becomes its child, so a Pi turn shows the
 * same session grouping as an AI SDK turn. Outside any active trace it
 * still records as a standalone generation.
 *
 * `onSettle` receives the generation so the caller can attach model usage
 * and cost once the stream resolve — the observation must not be updated
 * after the callback returns (the span ends then).
 */
export const tracePiGeneration = async <T>(
  params: {
    /** Observation name — the supply + entry, e.g. `pi.chat.generate`. */
    name: string;
    model: string;
    provider?: string;
    sessionId?: string;
    /** Request parameters worth recording (maxTokens, temperature...). */
    modelParameters?: Record<string, string | number>;
    input?: unknown;
  },
  run: (onSettle: (usage: PiGenerationSettle) => void) => Promise<T>
): Promise<T> => {
  if (!isLangfuseEnabled()) {
    // No-op path: the call still runs, nothing is recorded.
    return run(() => undefined);
  }

  return startActiveObservation(
    params.name,
    async (generation: LangfuseGeneration) => {
      generation.update({
        ...(params.input !== undefined ? { input: params.input } : {}),
        model: params.model,
        ...(params.modelParameters ? { modelParameters: params.modelParameters } : {}),
        metadata: {
          supply: 'pi',
          ...(params.provider ? { provider: params.provider } : {}),
          ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        },
      });

      const result = await run(usage => {
        generation.update({
          ...(usage.output !== undefined ? { output: usage.output } : {}),
          ...(usage.usageDetails ? { usageDetails: usage.usageDetails } : {}),
          ...(usage.costUsd !== undefined ? { costDetails: { total: usage.costUsd } } : {}),
          ...(usage.errorMessage ? { level: 'ERROR', statusMessage: usage.errorMessage } : {}),
        });
      });

      return result;
    },
    {
      asType: 'generation',
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    }
  );
};

/** The usage/cost summary a Pi caller hands back when its stream settles. */
export type PiGenerationSettle = {
  output?: unknown;
  /** Token counts in Langfuse's own vocabulary (prompt/completion/total). */
  usageDetails?: Record<string, number>;
  /** USD, from the model's catalog rates via Pi's calculateCost. */
  costUsd?: number;
  errorMessage?: string;
};
