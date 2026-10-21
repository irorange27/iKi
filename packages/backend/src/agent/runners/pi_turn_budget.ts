import type { ModelMessage } from '../../message/model_history';

import { generateThreadSummary } from '../../runtimes/thread_summary';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import { autoCompactHistory, estimateMessageTokens, estimateTextTokens } from '../context_budget';

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
  const totalTokens = params.requestView.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const planned = autoCompactHistory({
    history: params.requestView,
    maxInputTokens: params.force
      ? Math.max(1, totalTokens)
      : params.maxInputTokens - params.overheadTokens,
  });
  if (!planned.compacted) {
    return { compacted: false, viewTokens: totalTokens };
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
