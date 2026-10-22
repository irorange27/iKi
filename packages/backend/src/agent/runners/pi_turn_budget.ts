import type { ModelMessage } from '../../message/model_history';

import { generateThreadSummary } from '../../runtimes/thread_summary';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import {
  AUTO_COMPACT_KEEP_RATIO,
  autoCompactHistory,
  estimateMessageTokens,
  estimateTextTokens,
} from '../context_budget';
import { frameCheckpoint } from '../../runtimes/compaction_prompt';

const COMPACTION_RETRIES = 1;

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
  history?: ModelMessage[];
  threadId?: string;
  signal?: AbortSignal;
  existingSummary?: string;
}): Promise<string> => {
  const summary = await generateThreadSummary({
    ...(params.threadId ? { threadId: params.threadId } : {}),
    ...(params.signal ? { abortSignal: params.signal } : {}),
    ...(params.existingSummary ? { existingSummary: params.existingSummary } : {}),
    ...(params.history && params.history.length > 0 ? { history: params.history } : {}),
    messages: summarizerMessages(params.omitted),
  });
  if (!summary) {
    throw new Error('Context compaction failed; original history has been preserved.');
  }
  return summary.summary;
};

export const preparePiTurnHistory = async (params: {
  history: ModelMessage[];
  personaPrompt: string;
  planPrompt: string;
  transcriptSystemText: string;

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
      history,
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    params.signal?.throwIfAborted();
    const summaryMessage: ModelMessage = {
      role: 'system',
      content: frameCheckpoint(summaryText),
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

      requestView: ModelMessage[];

      summaryMessage: ModelMessage;
      omittedCount: number;

      viewTokens: number;
    }
  | { compacted: false; viewTokens: number };

export const compactPiRequestStep = async (params: {
  requestView: ModelMessage[];
  maxInputTokens: number;
  overheadTokens: number;

  force?: boolean;
  threadId?: string;
  signal?: AbortSignal;
  existingSummary?: string;

  previousSummaryMessage?: ModelMessage;
}): Promise<CompactPiRequestStepResult> => {
  const budget = params.maxInputTokens - params.overheadTokens;
  const originalTokens = params.requestView.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  let view = params.requestView;
  let previousSummaryMessage = params.previousSummaryMessage;
  let lastTokens = originalTokens;
  let compactedAny = false;
  let lastOmittedCount = 0;
  let lastSummaryMessage: ModelMessage | undefined;
  // Each pass supersedes the previous checkpoint, so the next pass must merge
  // into the summary it just produced, not the one this call started with.
  let existingSummary = params.existingSummary;

  // DSH retries a compaction that lands above the threshold before failing. A
  // retry halves the retained share, because re-slicing at the same keepRatio
  // reproduces the same oversized view and pays for a summarization call that
  // cannot change the outcome.
  for (let attempt = 0; attempt <= COMPACTION_RETRIES; attempt += 1) {
    const planned = autoCompactHistory({
      history: view,
      maxInputTokens: params.force ? Math.max(1, lastTokens) : budget,
      keepRatio: AUTO_COMPACT_KEEP_RATIO / 2 ** attempt,
    });
    // "Nothing left to compact" is not a failure: the view is already all
    // protected content. Only landing above budget after a real compaction is.
    if (!planned.compacted) break;

    const summaryText = await summarizeOmitted({
      omitted: planned.omitted,
      history: view,
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
      ...(existingSummary ? { existingSummary } : {}),
    });
    params.signal?.throwIfAborted();
    existingSummary = summaryText;
    const summaryMessage: ModelMessage = {
      role: 'system',
      content: frameCheckpoint(summaryText),
    };
    view = [
      ...planned.history.filter(
        message => message.role === 'system' && message !== previousSummaryMessage
      ),
      summaryMessage,
      ...planned.history.filter(message => message.role !== 'system'),
    ];
    previousSummaryMessage = summaryMessage;
    lastSummaryMessage = summaryMessage;
    lastOmittedCount = planned.omitted.length;
    lastTokens = view.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    compactedAny = true;

    if (params.force || lastTokens <= budget) {
      return {
        compacted: true,
        requestView: view,
        summaryMessage,
        omittedCount: lastOmittedCount,
        viewTokens: lastTokens,
      };
    }
  }

  if (!compactedAny) {
    return { compacted: false, viewTokens: originalTokens };
  }
  if (lastSummaryMessage && lastTokens <= budget) {
    return {
      compacted: true,
      requestView: view,
      summaryMessage: lastSummaryMessage,
      omittedCount: lastOmittedCount,
      viewTokens: lastTokens,
    };
  }

  throw new Error(
    `Context compaction could not get under the budget after ${COMPACTION_RETRIES + 1} attempt(s) (${lastTokens} > ${budget}); history has been preserved.`
  );
};
