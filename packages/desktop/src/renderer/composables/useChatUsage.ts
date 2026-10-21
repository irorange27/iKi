import { computed, toRaw, type Ref } from 'vue';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import {
  buildSessionPerfStats,
  getTokenUsageSummary,
  type TokenUsageSummary,
  type SessionPerfStats,
} from '../modules/chat/ui_message_references';

export const useChatUsage = (
  getMessages: () => ChatUiMessage[],
  getRevision: () => number,
  usageChunkTick: Ref<number>
) => {
  const sameStats = <T extends object>(previous: T | null | undefined, next: T | null): boolean =>
    previous === next ||
    Boolean(
      previous &&
      next &&
      (Object.keys(next) as Array<keyof T>).every(key => Object.is(previous[key], next[key]))
    );

  const latestAssistantTokenUsage = computed<TokenUsageSummary | null>(previous => {
    void usageChunkTick.value;
    void getRevision();
    void getMessages().length;
    const messages = toRaw(getMessages());

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== 'assistant') continue;

      const summary = getTokenUsageSummary(message);
      if (summary.inputTokens !== null)
        return previous && sameStats(previous, summary) ? previous : summary;
    }

    return null;
  });

  const sessionPerfStats = computed<SessionPerfStats | null>(previous => {
    void usageChunkTick.value;
    void getRevision();
    void getMessages().length;
    const next = buildSessionPerfStats(toRaw(getMessages()));
    return previous && sameStats(previous, next) ? previous : next;
  });

  return { latestAssistantTokenUsage, sessionPerfStats };
};
