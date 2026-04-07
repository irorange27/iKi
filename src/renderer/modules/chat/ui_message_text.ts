import {
  extractTextFromMessageParts,
  isObjectRecord,
  isTextPart,
  type ChatUiMessage,
  type TextPart,
} from '../../../shared/chat/message_parts';

export const extractTextFromMessage = (message: ChatUiMessage | undefined): string => {
  if (!message || !Array.isArray(message.parts)) return '';
  return extractTextFromMessageParts(message.parts);
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
