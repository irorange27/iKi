const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isToolLikeModelMessagePart = (part: unknown): boolean =>
  isObjectRecord(part) &&
  typeof part.type === 'string' &&
  (part.type === 'dynamic-tool' || part.type.startsWith('tool-'));

export const extractTextFromModelMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      part =>
        isObjectRecord(part) &&
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.length > 0
    )
    .map(part => String((part as { text: string }).text))
    .join('');
};

export const hasToolPartInModelMessageContent = (content: unknown): boolean =>
  Array.isArray(content) && content.some(isToolLikeModelMessagePart);

const assistantAnchorsToolResponses = (message: { role: string; content: unknown } | undefined) =>
  message?.role === 'assistant' && hasToolPartInModelMessageContent(message.content);

export const sanitizeModelConversationMessages = <
  TMessage extends { role: string; content: unknown },
>(
  messages: TMessage[]
): { messages: TMessage[]; droppedMessages: number } => {
  const sanitizedMessages: TMessage[] = [];
  let withinAnchoredToolRun = false;
  let droppedMessages = 0;

  for (const message of messages) {
    if (message.role === 'tool') {
      const previousMessage = sanitizedMessages.at(-1);
      if (!withinAnchoredToolRun && !assistantAnchorsToolResponses(previousMessage)) {
        droppedMessages += 1;
        continue;
      }

      sanitizedMessages.push(message);
      withinAnchoredToolRun = true;
      continue;
    }

    sanitizedMessages.push(message);
    withinAnchoredToolRun = false;
  }

  return {
    messages: sanitizedMessages,
    droppedMessages,
  };
};
