import { RefusalError, getErrorMessage } from '@iki/backend/utils/errors';

// Shared retry vocabulary for the two Pi turn harnesses (text + tool). The
// driver loops stay per-harness — they stream and recover differently — but
// the budget, backoff shape, failure classification and recovery-note wording
// must not drift between them.

export const PI_RETRY_MAX_ATTEMPTS = 3;
const PI_RETRY_BASE_DELAY_MS = 1000;
const PI_RETRY_MAX_DELAY_MS = 30000;

export const CONTENT_FILTER_PATTERN = /content_filter/i;

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** Exponential backoff over the number of already-failed attempts. */
export const piRetryDelayMs = (failedAttempts: number): number =>
  Math.min(PI_RETRY_BASE_DELAY_MS * Math.pow(2, failedAttempts), PI_RETRY_MAX_DELAY_MS);

export const contentFilterRefusal = (partialText?: string): RefusalError =>
  new RefusalError('Model response was blocked by content filter', 'content-filter', partialText);

export const providerErrorStop = (errorMessage?: string): Error =>
  new Error(errorMessage || 'Provider returned an error stop reason');

export const emptyResponseRefusal = (stopReason?: string): RefusalError =>
  new RefusalError('Model returned an empty response with no tool calls', stopReason, undefined);

const RECOVERY_NOTE_SUFFIX = '\n\n---\nContinue with the original task.';

export const recoveryNoteFor = (failure: Error): string =>
  (failure instanceof RefusalError
    ? 'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.'
    : `Your last attempt encountered an error: ${getErrorMessage(failure)}. Please try a different approach or simplify your response to avoid this issue.`) +
  RECOVERY_NOTE_SUFFIX;
