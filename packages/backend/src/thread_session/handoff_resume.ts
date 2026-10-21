import type { ModelMessage } from '../message/model_history';
import { rebuildResumeHistoryFromEvents } from './run_rehydrator';
import type { ChatInputMessage } from './types';

export type HandoffDetails = {
  summary: string;
  nextSteps: string;
  reason: string;
};

const findLatestHandoffArgs = (
  resumedMessages: ModelMessage[]
): Record<string, unknown> | null => {
  for (let i = resumedMessages.length - 1; i >= 0; i--) {
    const msg = resumedMessages[i] as Record<string, unknown>;
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === 'object' &&
        part !== null &&
        (part as Record<string, unknown>).type === 'tool-call' &&
        (part as Record<string, unknown>).toolName === 'handoff'
      ) {

        const args =
          ((part as Record<string, unknown>).input as Record<string, unknown> | undefined) ??
          ((part as Record<string, unknown>).args as Record<string, unknown> | undefined);
        return args ?? {};
      }
    }
  }
  return null;
};

export const buildHandoffResumeContext = async (params: {
  threadId: string | null | undefined;
  preparedHistory: ChatInputMessage[];
  preparedPrompt: string;
}): Promise<{ history: ModelMessage[]; prompt: string } | null> => {
  const threadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  if (!threadId) return null;
  const replayed = await rebuildResumeHistoryFromEvents(threadId);
  const resumedMessages = replayed?.history ?? [];
  if (resumedMessages.length === 0) return null;

  const args = findLatestHandoffArgs(resumedMessages) ?? {};
  const handoffSummary = typeof args.summary === 'string' ? args.summary : '';
  const handoffNextSteps = typeof args.next_steps === 'string' ? args.next_steps : '';
  const handoffReason = typeof args.reason === 'string' ? args.reason : '';

  const handoffContextParts: string[] = ['You are resuming work from a previous agent run.'];
  if (handoffSummary) {
    handoffContextParts.push(`\nSummary of previous work:\n${handoffSummary}`);
  }
  if (handoffNextSteps) {
    handoffContextParts.push(`\nNext steps to complete:\n${handoffNextSteps}`);
  }
  if (handoffReason) {
    handoffContextParts.push(`\nReason for handoff: ${handoffReason}`);
  }
  handoffContextParts.push(
    '\nThe conversation history from the previous run is below. Continue the work based on what was done before.'
  );

  return {
    history: [
      { role: 'system', content: `[HANDOFF CONTEXT] ${handoffContextParts.join('')}` },
      ...resumedMessages,
      ...(params.preparedHistory.length > 0
        ? [
            {
              role: 'system' as const,
              content:
                '[CURRENT THREAD] The following messages are from the current conversation thread:',
            } as ModelMessage,
            ...params.preparedHistory,
          ]
        : []),
    ],
    prompt: params.preparedPrompt || 'Continue the work from where the previous agent left off.',
  };
};

export const buildFreshHandoffSystemMessage = (handoff: HandoffDetails): string =>
  [
    '[HANDOFF CONTEXT] You are a fresh agent instance continuing work handed off from a previous agent.',
    '',
    `Summary of completed work:\n${handoff.summary}`,
    '',
    `Next steps to complete:\n${handoff.nextSteps}`,
    '',
    `Reason for handoff: ${handoff.reason}`,
    '',
    'You have a clean context window. Start working on the next steps immediately.',
  ].join('\n');
