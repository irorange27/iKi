import { createLogger } from '@iki/backend/logger';
import { parseStoredUiMessageRow } from '@iki/backend/message/ui_message_codec';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import { findMessageEvent } from '@iki/backend/db/session_events';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';

const logger = createLogger({ module: 'turn_persistence' });

export type ConversationStore = {
  createMessage: (input: unknown) => unknown;
  upsertTurnMessage: (input: unknown) => unknown;
};

const UI_MESSAGE_METADATA_FORMAT = 'ai-ui-message-v1';

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
): { messageId: string; message: ChatUiMessage; runId: string; system?: string[] } | undefined => {
  const lastUser = [...options.messages].reverse().find(message => message.role === 'user');
  const content = (lastUser as { content?: unknown } | undefined)?.content;
  if (!lastUser || typeof content !== 'string' || !content.trim()) return undefined;
  const system: string[] = [];
  for (const message of options.messages) {
    if (message.role !== 'system') continue;
    const systemContent = (message as { content?: unknown }).content;
    if (typeof systemContent !== 'string') return undefined;
    if (systemContent.trim()) system.push(systemContent);
  }
  const messageId = `input_${runId}`;
  return {
    messageId,
    message: { id: messageId, role: 'user', parts: [{ type: 'text', text: content }] },
    runId,
    ...(system.length > 0 ? { system } : {}),
  };
};

export const persistUserTurnMessage = (
  _conversation: Pick<ConversationStore, 'createMessage'>,
  options: ChatTurnOptions
): string | undefined => {
  if (!options.threadId) return undefined;
  const picked = pickUserTurnMessage(options);
  if (!picked) return undefined;
  return picked.messageId;
};

const assistantUpsertChains = new Map<string, Promise<void>>();

export const persistAssistantTurnMessage = (
  conversation: Pick<ConversationStore, 'upsertTurnMessage'>,
  threadId: string,
  message: { id: string; role: 'assistant'; parts: unknown[] },
  transport: string,
  parentId?: string
): Promise<void> => {
  const run = (assistantUpsertChains.get(message.id) ?? Promise.resolve()).then(async () => {
    try {
      await conversation.upsertTurnMessage({
        id: message.id,
        thread_id: threadId,
        ...(parentId ? { parent_id: parentId } : {}),
        message,
        metadata: JSON.stringify({ format: UI_MESSAGE_METADATA_FORMAT, transport }),
      });
    } catch (error) {
      logger.event({
        level: 'warn',
        event: 'chat.turn.assistant_persist',
        outcome: 'degraded',
        message: 'Failed to persist the assistant turn message.',
        error,
        data: { thread_id: threadId, message_id: message.id },
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
    const message = (found.payload as { message?: unknown }).message;
    const parsed = parseStoredUiMessageRow({
      id: messageId,
      message: JSON.stringify(message ?? {}),
    });
    const parts =
      parsed && typeof parsed === 'object' ? (parsed as { parts?: unknown }).parts : null;
    return Array.isArray(parts) ? parts : undefined;
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
