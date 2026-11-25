import * as chatThreadDb from '@iki/store/chat_thread';
import { createLogger } from '@iki/core/logger';
import type { ChatThread } from '@iki/core/types/chat';

const chatThreadHintsLogger = createLogger({ module: 'chat_thread_hints' });

const PLACEHOLDER_TITLES = new Set(['', 'new chat', 'interactive cli', '新对话']);
const MAX_AUTO_TITLE_CHARS = 60;

export const isPlaceholderThreadTitle = (title: string | null | undefined): boolean =>
  PLACEHOLDER_TITLES.has((title ?? '').trim().toLowerCase());

export const deriveThreadTitleFromPrompt = (
  prompt: string,
  maxChars = MAX_AUTO_TITLE_CHARS
): string => {
  const firstNonEmptyLine =
    prompt
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean) ?? '';
  const collapsed = firstNonEmptyLine.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > maxChars
    ? `${collapsed.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`
    : collapsed;
};

/**
 * Remember which provider/model served this thread, as fields on the row.
 * `patchRow` stamps `updated_at`, so the binding's freshness is the row's
 * freshness — there is no nested "runtime hints" document to merge anymore.
 * Also promotes placeholder titles (`New Chat` / `Interactive CLI`) to the
 * first user message text once the thread receives real user input.
 */
export const persistThreadRuntimeHints = (params: {
  threadId: string;
  providerType: string;
  providerId?: string;
  model: string;
  firstUserPrompt?: string;
}): void => {
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  if (!normalizedThreadId) return;

  try {
    const thread = chatThreadDb.getChatThread(normalizedThreadId);
    const derivedTitle =
      thread && isPlaceholderThreadTitle(thread.title) && params.firstUserPrompt
        ? deriveThreadTitleFromPrompt(params.firstUserPrompt)
        : '';

    const update: Partial<ChatThread> = {
      model: params.model || thread?.model || undefined,
      provider_type: params.providerType,
      provider_id: params.providerId?.trim() || null,
      ...(derivedTitle ? { title: derivedTitle } : {}),
    };
    chatThreadDb.updateChatThread(normalizedThreadId, update);
  } catch (error) {
    chatThreadHintsLogger.event({
      level: 'warn',
      event: 'chat.thread_hints.persist',
      outcome: 'failed',
      error,
      entity: {
        thread_id: normalizedThreadId,
      },
    });
  }
};
