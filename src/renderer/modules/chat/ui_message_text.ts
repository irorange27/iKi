import type { UIMessage } from 'ai';

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isTextPart = (part: unknown): part is { type: 'text'; text: string } =>
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
    if (isObjectRecord(part) && part.type === 'text') {
      if (replaced) continue;
      nextParts.push({
        ...(part as any),
        type: 'text',
        text: nextText,
        state: 'done',
      } as any);
      replaced = true;
      continue;
    }
    nextParts.push(part);
  }

  if (!replaced) {
    nextParts.unshift({ type: 'text', text: nextText, state: 'done' } as any);
  }

  return nextParts;
};

