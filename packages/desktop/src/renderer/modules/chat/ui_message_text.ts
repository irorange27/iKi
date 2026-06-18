import {
  createComposerInvocationPart,
  extractTextFromMessageParts,
  isComposerInvocationPart,
  isTextPart,
  type ChatUiMessage,
  type ComposerInvocationPartData,
} from '@iki/core/chat/message_parts';

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

export const upsertComposerInvocationIntoMessageParts = (
  parts: ChatUiMessage['parts'],
  nextComposerInvocations?: ComposerInvocationPartData
): ChatUiMessage['parts'] => {
  const nextParts = parts.filter(part => !isComposerInvocationPart(part));
  const tokens = nextComposerInvocations?.tokens?.filter(
    token =>
      token &&
      typeof token.id === 'string' &&
      typeof token.label === 'string' &&
      token.label.trim().length > 0
  );

  if (!tokens || tokens.length === 0) {
    return nextParts;
  }

  return [
    createComposerInvocationPart({
      tokens,
    }),
    ...nextParts,
  ];
};
