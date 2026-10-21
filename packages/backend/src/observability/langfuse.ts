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

export const tracePiGeneration = async <T>(
  params: {

    name: string;
    model: string;
    provider?: string;
    sessionId?: string;

    modelParameters?: Record<string, string | number>;
    input?: unknown;
  },
  run: (onSettle: (usage: PiGenerationSettle) => void) => Promise<T>
): Promise<T> => {
  if (!isLangfuseEnabled()) {

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

export type PiGenerationSettle = {
  output?: unknown;

  usageDetails?: Record<string, number>;

  costUsd?: number;
  errorMessage?: string;
};
