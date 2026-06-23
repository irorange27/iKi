import { LangfuseSpanProcessor } from '@langfuse/otel';
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
