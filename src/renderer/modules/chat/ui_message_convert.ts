import type { UIMessage } from 'ai';
import { isObjectRecord, type ObjectRecord } from '../../../shared/utils/guards';
import { createPrefixedId } from '../../../shared/utils/id';

type MessageRole = 'system' | 'user' | 'assistant';

const isValidRole = (role: unknown): role is MessageRole =>
  role === 'system' || role === 'user' || role === 'assistant';

const makeUiMessageId = () => createPrefixedId('ui', { randomLength: 6 });

const normalizeParts = (parts: unknown, content: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(parts)) {
    const filtered = parts.filter(
      part => isObjectRecord(part) && typeof part.type === 'string'
    ) as Array<Record<string, unknown>>;
    if (filtered.length > 0) {
      return filtered;
    }
  }

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return [{ type: 'text', text: '' }];
};

export const toUiMessages = (messages: unknown[]): UIMessage[] => {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (message): message is ObjectRecord & { role: MessageRole } =>
        isObjectRecord(message) && isValidRole(message.role)
    )
    .map(message => {
      const parts = normalizeParts(message.parts, message.content);
      const id =
        typeof message.id === 'string' && message.id.length > 0 ? message.id : makeUiMessageId();
      return {
        id,
        role: message.role,
        parts,
      } as unknown as UIMessage;
    });
};
