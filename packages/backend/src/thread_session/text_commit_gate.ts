import {
  MODEL_TEXT_COMMITTED,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
  SessionLogCommitError,
} from './session_log';

export type TextCommitGate = {
  /** Buffer a streamed delta, flushing when the interval has elapsed. */
  buffer: (text: string) => void;
  /** Write whatever is buffered to the session log, then publish it. */
  flush: () => void;
};

/**
 * The one place streamed text becomes visible.
 *
 * A delta is buffered and only published after its durable append succeeds, so
 * every chunk the user has seen is already in the session log — on the success,
 * cancel, and failure paths alike. A failed append throws
 * `SessionLogCommitError` carrying the text that never made it, which the turn
 * failure path turns into a retryable diagnostic.
 */
export const createTextCommitGate = (params: {
  threadId: string;
  runId: () => string;
  messageId: string;
  publish: (text: string) => void;
  previewText: () => string;
  intervalMs: number;
}): TextCommitGate => {
  let pending = '';
  let seq = 0;
  let lastFlushAt = Date.now();

  const flush = () => {
    if (!pending) return;
    const text = pending;
    lastFlushAt = Date.now();
    try {
      recordSessionEvents(params.threadId, [
        {
          type: MODEL_TEXT_COMMITTED,
          version: SESSION_EVENT_VERSION,
          payload: {
            runId: params.runId(),
            messageId: params.messageId,
            seq,
            text,
          },
        },
      ]);
    } catch (error) {
      throw new SessionLogCommitError(text, params.previewText(), { cause: error });
    }
    pending = '';
    seq += 1;
    params.publish(text);
  };

  return {
    flush,
    buffer: (text: string) => {
      pending += text;
      if (Date.now() - lastFlushAt >= params.intervalMs) flush();
    },
  };
};
