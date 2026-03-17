import type { UIMessage } from 'ai';

import type { TextPart } from '../../../shared/chat/message_parts';
import { isObjectRecord } from '../../../shared/chat/tool_parts';

export const isTextPart = (part: unknown): part is TextPart =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

export const extractTextFromMessage = (message: UIMessage | undefined): string => {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter(isTextPart)
    .map(part => part.text)
    .join('');
};

export const upsertTextIntoMessageParts = (
  parts: UIMessage['parts'],
  nextText: string
): UIMessage['parts'] => {
  const nextParts: UIMessage['parts'] = [];
  let replaced = false;

  for (const part of parts) {
    if (isTextPart(part)) {
      if (replaced) continue;
      nextParts.push({
        ...part,
        type: 'text',
        text: nextText,
        state: 'done',
      });
      replaced = true;
      continue;
    }
    nextParts.push(part);
  }

  if (!replaced) {
    nextParts.unshift({ type: 'text', text: nextText, state: 'done' });
  }

  return nextParts;
};
