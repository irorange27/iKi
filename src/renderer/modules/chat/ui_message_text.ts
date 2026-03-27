import type { ChatUiMessage, TextPart } from '../../../shared/chat/message_parts';
import { isObjectRecord } from '../../../shared/chat/tool_parts';

export const isTextPart = (part: unknown): part is TextPart =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

export const extractTextFromMessage = (message: ChatUiMessage | undefined): string => {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter(isTextPart)
    .map(part => part.text)
    .join('');
};

export const upsertTextIntoMessageParts = (
  parts: ChatUiMessage['parts'],
  nextText: string
): ChatUiMessage['parts'] => {
  const nextParts: ChatUiMessage['parts'] = [];
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
