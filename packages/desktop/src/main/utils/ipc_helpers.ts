import { createLogger } from '@iki/core/logger';

import { getAllBrowserWindows } from './browser_windows';

type IpcLogger = ReturnType<typeof createLogger>;

/**
 * One home for the IPC handler error contract: log `ipc.<name>` as failed,
 * then let the caller decide between a fallback value and rethrowing.
 * T infers from `run`; NoInfer keeps the onError arrow out of the inference.
 */
export const withIpcLogging = async <T>(
  logger: IpcLogger,
  event: string,
  run: () => T | Promise<T>,
  options: { onError: (error: unknown) => NoInfer<T>; entity?: Record<string, unknown> }
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    logger.event({
      level: 'error',
      event,
      outcome: 'failed',
      error,
      ...(options.entity ? { entity: options.entity } : {}),
    });
    return options.onError(error);
  }
};

/**
 * One home for pushing a payload to every renderer window. A destroyed
 * webContents must not break the remaining deliveries.
 */
export const broadcastToRenderers = (channel: string, payload: unknown): void => {
  for (const win of getAllBrowserWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* empty: a destroyed window must not block the others */
    }
  }
};
