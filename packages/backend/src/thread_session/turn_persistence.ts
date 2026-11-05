import { createLogger } from '@iki/core/logger';
import { normalizeUiMessage } from '@iki/backend/message/ui_message_codec';
import { isObjectRecord } from '@iki/core/utils/guards';
import { findMessageEvent } from '@iki/store/session_events';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';

const logger = createLogger({ module: 'turn_persistence' });

type ConversationStore = {
  createMessage: (input: unknown) => unknown;
  upsertTurnMessage: (input: unknown) => unknown;
};

export const pickUserTurnMessage = (
  options: ChatTurnOptions
): { messageId: string; message: unknown } | undefined => {
  const lastUser = [...options.messages].reverse().find(message => message.role === 'user');
  if (!lastUser) return undefined;
  const id = typeof (lastUser as { id?: unknown }).id === 'string' ? (lastUser as { id: string }).id : '';
  if (!id.trim()) return undefined;
  return { messageId: id, message: lastUser };
};

export const pickIdLessSendInput = (
  options: ChatTurnOptions,
  runId: string
): { messageId: string; message: ChatUiMessage; runId: string } | undefined => {
  const lastUser = [...options.messages].reverse().find(message => message.role === 'user');
  const content = (lastUser as { content?: unknown } | undefined)?.content;
  if (!lastUser || typeof content !== 'string' || !content.trim()) return undefined;
  const messageId = `input_${runId}`;
  return {
    messageId,
    message: { id: messageId, role: 'user', parts: [{ type: 'text', text: content }] },
    runId,
  };
};

const assistantUpsertChains = new Map<string, Promise<void>>();

/**
 * Persist the assistant message reduced from the UI chunk log the client
 * consumed. `opts` is a required positional object, not loose trailing args:
 * the call site must name the run that is writing the fact. That runId is what
 * lets the replay's dead-chain exclusion drop every committed copy of a failed
 * run — an unstamped copy survives exclusion and its settled tool parts re-enter
 * the retry request as a duplicate tool-call the provider rejects.
 */
export const persistAssistantTurnMessage = (
  conversation: Pick<ConversationStore, 'upsertTurnMessage'>,
  threadId: string,
  message: { id: string; role: 'assistant'; parts: unknown[] },
  transport: string,
  opts: { runId: string }
): Promise<void> => {
  const run = (assistantUpsertChains.get(message.id) ?? Promise.resolve()).then(async () => {
    try {
      await conversation.upsertTurnMessage({
        id: message.id,
        thread_id: threadId,
        runId: opts.runId,
        transport,
        message,
      });
    } catch (error) {
      logger.event({
        level: 'warn',
        event: 'chat.turn.assistant_persist',
        outcome: 'degraded',
        message: 'Failed to persist the assistant turn message.',
        error,
        data: { thread_id: threadId, message_id: message.id, run_id: opts.runId },
      });
    }
  });
  assistantUpsertChains.set(
    message.id,
    run.finally(() => {
      if (assistantUpsertChains.get(message.id) === run) assistantUpsertChains.delete(message.id);
    })
  );
  return run;
};

export const loadPersistedAssistantParts = (messageId: string): unknown[] | undefined => {
  if (!messageId.trim()) return undefined;
  try {

    const found = findMessageEvent(messageId);
    if (!found) return undefined;
    const payload = isObjectRecord(found.payload) ? found.payload : {};
    const ui = normalizeUiMessage(payload.message, { fallbackId: messageId });
    return ui ? ui.parts : undefined;
  } catch (error) {
    logger.event({
      level: 'warn',
      event: 'chat.turn.seed_load',
      outcome: 'degraded',
      message: 'Failed to load the persisted assistant parts for continuation seeding.',
      error,
      data: { message_id: messageId },
    });
    return undefined;
  }
};
