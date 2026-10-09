import type { ModelMessage } from 'ai';

import { generateThreadSummary } from '../../runtimes/thread_summary';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import { autoCompactHistory, estimateMessageTokens, estimateTextTokens } from '../context_budget';

/**
 * The input budget owner shared by the Pi harnesses (text and tool) — the
 * AI SDK prepareStep semantics over the same owners: compact at
 * tool-exchange boundaries, summarize the omitted prefix, then refuse if
 * protected instructions or the current turn alone exceed the budget.
 * Compaction is request-scoped: the caller's stored history keeps the full
 * text. Cadence (switch debt #122, prepareStep parity): the TOOL harness
 * checks every request — once at turn start through `preparePiTurnHistory`
 * and again before each later model call through `compactPiRequestStep` —
 * so an autonomous chain no longer grows its request unbounded within a
 * batch. The text harness is single-call and keeps the turn-start check
 * only.
 *
 * The summarizer takes no cache prefix on the Pi path (falls back to its
 * standalone call) — the same accepted degradation as custom-model runs,
 * tracked for both Pi surfaces.
 */

/** The summarizer's input shape over omitted history (shared by both
 * compaction entry points). Tool messages fold into a JSON payload — the
 * summarizer's LLM cannot address tool roles. */
const summarizerMessages = (omitted: ModelMessage[]) =>
  omitted.map(message => ({
    role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify({ role: message.role, content: message.content }),
  }));

const summarizeOmitted = async (params: {
  omitted: ModelMessage[];
  threadId?: string;
  signal?: AbortSignal;
  existingSummary?: string;
}): Promise<string> => {
  const summary = await generateThreadSummary({
    ...(params.threadId ? { threadId: params.threadId } : {}),
    ...(params.signal ? { abortSignal: params.signal } : {}),
    ...(params.existingSummary ? { existingSummary: params.existingSummary } : {}),
    messages: summarizerMessages(params.omitted),
  });
  if (!summary) {
    throw new Error('Context compaction failed; original history has been preserved.');
  }
  return summary.summary;
};

/** The turn-start check: compact once before the first request. */
export const preparePiTurnHistory = async (params: {
  history: ModelMessage[];
  personaPrompt: string;
  planPrompt: string;
  transcriptSystemText: string;
  /** Tool-schema estimate on the Pi wire — part of the fixed overhead, the
   * same term the AI SDK overhead carries (omitting it delays compaction). */
  toolSchemaTokens?: number;
  maxInputTokens?: number;
  threadId?: string;
  signal?: AbortSignal;
}): Promise<{ requestHistory: ModelMessage[]; summaryMessage?: ModelMessage }> => {
  const { history } = params;
  const overhead = estimateTextTokens(
    assembleRequestSystemPrompt([
      { slot: 'persona', text: params.personaPrompt },
      { slot: 'planPrompt', text: params.planPrompt },
      { slot: 'transcriptSystem', text: params.transcriptSystemText },
    ]).prompt
  );
  if (!params.maxInputTokens) return { requestHistory: history };

  const planned = autoCompactHistory({
    history,
    maxInputTokens: params.maxInputTokens - overhead - (params.toolSchemaTokens ?? 0),
  });
  let requestHistory = history;
  let turnStartSummaryMessage: ModelMessage | undefined;
  if (planned.compacted) {
    const summaryText = await summarizeOmitted({
      omitted: planned.omitted,
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    params.signal?.throwIfAborted();
    const summaryMessage: ModelMessage = {
      role: 'system',
      content: `Earlier conversation summary:\n${summaryText}`,
    };
    turnStartSummaryMessage = summaryMessage;
    requestHistory = [
      ...planned.history.filter(message => message.role === 'system'),
      summaryMessage,
      ...planned.history.filter(message => message.role !== 'system'),
    ];
  }
  const overheadWithTools = overhead + (params.toolSchemaTokens ?? 0);
  if (
    requestHistory.reduce((sum, message) => sum + estimateMessageTokens(message), overheadWithTools) >
    params.maxInputTokens
  ) {
    throw new Error(
      'Context budget exceeded by protected instructions or the current turn; history has been preserved.'
    );
  }
  return { requestHistory, ...(turnStartSummaryMessage ? { summaryMessage: turnStartSummaryMessage } : {}) };
};

export type CompactPiRequestStepResult =
  | {
      compacted: true;
      /** The compacted request view — systems, the summary message, then the
       * kept tail. Replaces the caller's view; the caller's STORED history is
       * untouched (compaction is request-scoped). */
      requestView: ModelMessage[];
      /** The summary message — chained into the next compaction's
       * `existingSummary` within the same turn. */
      summaryMessage: ModelMessage;
      omittedCount: number;
      /** Estimate of the compacted view alone — the caller adds its overhead
       * and refuses when the total still exceeds the budget. */
      viewTokens: number;
    }
  | { compacted: false; viewTokens: number };

/**
 * The per-request check inside a multi-step tool turn (prepareStep parity):
 * estimate the request view; over the compaction threshold, summarize the
 * omitted prefix and return the compacted view. UNDER the threshold this is
 * one reduce pass — checks are cheap, compaction is rare. The caller owns
 * the placement effects: rebuild its request transcript from the returned
 * view, switch its snapshot basis, and refuse when `viewTokens + overhead`
 * still exceeds the budget. `existingSummary` chains compactions within one
 * turn (the same per-turn scope as the AI SDK runner's summary message).
 */
export const compactPiRequestStep = async (params: {
  requestView: ModelMessage[];
  maxInputTokens: number;
  overheadTokens: number;
  threadId?: string;
  signal?: AbortSignal;
  existingSummary?: string;
  /** The view's CURRENT summary message — excluded from the kept systems so
   * the new summary REPLACES it (the AI SDK runner never accumulates
   * summaries; it chains their text via `existingSummary`). Identity
   * comparison: pass the exact object previously returned. */
  previousSummaryMessage?: ModelMessage;
}): Promise<CompactPiRequestStepResult> => {
  const planned = autoCompactHistory({
    history: params.requestView,
    maxInputTokens: params.maxInputTokens - params.overheadTokens,
  });
  if (!planned.compacted) {
    return {
      compacted: false,
      viewTokens: params.requestView.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
    };
  }
  const summaryText = await summarizeOmitted({
    omitted: planned.omitted,
    ...(params.threadId ? { threadId: params.threadId } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
    ...(params.existingSummary ? { existingSummary: params.existingSummary } : {}),
  });
  params.signal?.throwIfAborted();
  const summaryMessage: ModelMessage = {
    role: 'system',
    content: `Earlier conversation summary:\n${summaryText}`,
  };
  const requestView = [
    ...planned.history.filter(
      message => message.role === 'system' && message !== params.previousSummaryMessage
    ),
    summaryMessage,
    ...planned.history.filter(message => message.role !== 'system'),
  ];
  return {
    compacted: true,
    requestView,
    summaryMessage,
    omittedCount: planned.omitted.length,
    viewTokens: requestView.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
  };
};
