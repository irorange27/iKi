import type { ModelMessage } from 'ai';

import { generateThreadSummary } from '../../runtimes/thread_summary';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import { autoCompactHistory, estimateMessageTokens, estimateTextTokens } from '../context_budget';

/**
 * The turn-start input budget shared by the Pi harnesses (text and tool) —
 * the AI SDK prepareStep semantics over the same owners: compact at
 * tool-exchange boundaries, summarize the omitted prefix, then refuse if
 * protected instructions or the current turn alone exceed the budget.
 * Compaction is request-scoped: the caller's stored history keeps the full
 * text. (Per-step re-compaction inside a multi-step tool loop is a tracked
 * 3b item; the step count bounds 3a turns.)
 *
 * Without a cache prefix the summarizer falls back to its standalone call —
 * the same accepted degradation as custom-model runs.
 */
export const preparePiTurnHistory = async (params: {
  history: ModelMessage[];
  personaPrompt: string;
  planPrompt: string;
  transcriptSystemText: string;
  maxInputTokens?: number;
  threadId?: string;
  signal?: AbortSignal;
}): Promise<{ requestHistory: ModelMessage[] }> => {
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
    maxInputTokens: params.maxInputTokens - overhead,
  });
  let requestHistory = history;
  if (planned.compacted) {
    const summary = await generateThreadSummary({
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.signal ? { abortSignal: params.signal } : {}),
      messages: planned.omitted.map(message => ({
        role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify({ role: message.role, content: message.content }),
      })),
    });
    if (!summary) {
      throw new Error('Context compaction failed; original history has been preserved.');
    }
    const summaryMessage: ModelMessage = {
      role: 'system',
      content: `Earlier conversation summary:\n${summary.summary}`,
    };
    requestHistory = [
      ...planned.history.filter(message => message.role === 'system'),
      summaryMessage,
      ...planned.history.filter(message => message.role !== 'system'),
    ];
  }
  if (
    requestHistory.reduce((sum, message) => sum + estimateMessageTokens(message), overhead) >
    params.maxInputTokens
  ) {
    throw new Error(
      'Context budget exceeded by protected instructions or the current turn; history has been preserved.'
    );
  }
  return { requestHistory };
};
