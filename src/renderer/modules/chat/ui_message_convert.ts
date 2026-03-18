import type { UIMessage } from 'ai';
import { isObjectRecord } from '../../../shared/utils/guards';

type MessageRole = 'system' | 'user' | 'assistant';

const isValidRole = (role: unknown): role is MessageRole =>
  role === 'system' || role === 'user' || role === 'assistant';

const makeUiMessageId = () =>
  `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
    .filter(message => isObjectRecord(message) && isValidRole(message.role))
    .map(message => {
      const parts = normalizeParts(message.parts, message.content);
      const id =
        typeof message.id === 'string' && message.id.length > 0
          ? message.id
          : makeUiMessageId();
      return {
        id,
        role: message.role,
        parts,
      } as UIMessage;
    });
};
