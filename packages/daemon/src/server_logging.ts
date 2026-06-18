import http from 'node:http';

import { ZodError } from 'zod';

import { getSchemaErrorMessage } from './server_schemas';
import { writeJson } from './server_shared';

export type DaemonServerLogger = {
  event: (input: {
    level: 'debug' | 'info' | 'warn' | 'error';
    event: string;
    outcome?: 'succeeded' | 'failed' | 'degraded';
    message?: string;
    error?: unknown;
    data?: Record<string, unknown>;
  }) => unknown;
};

const REQUEST_BODY_TOO_LARGE_MESSAGE = 'Request body too large';

const getClientPayloadFailure = (
  error: unknown,
  fallback: string
): { status: number; error: string } => {
  if (error instanceof Error && error.message === REQUEST_BODY_TOO_LARGE_MESSAGE) {
    return {
      status: 413,
      error: REQUEST_BODY_TOO_LARGE_MESSAGE,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      error: 'Malformed JSON body',
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      error: getSchemaErrorMessage(error, fallback),
    };
  }
  return {
    status: 400,
    error: fallback,
  };
};

export const writeClientPayloadFailure = (
  res: http.ServerResponse,
  error: unknown,
  fallback: string
) => {
  const failure = getClientPayloadFailure(error, fallback);
  writeJson(res, failure.status, {
    success: false,
    error: failure.error,
  });
};

export const logDaemonHandlerFailure = (input: {
  logger: DaemonServerLogger;
  event: string;
  message: string;
  error: unknown;
  data?: Record<string, unknown>;
}) => {
  input.logger.event({
    level: 'error',
    event: input.event,
    outcome: 'failed',
    message: input.message,
    error: input.error,
    ...(input.data ? { data: input.data } : {}),
  });
};
