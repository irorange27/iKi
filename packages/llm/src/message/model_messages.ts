// Deliberately NOT utils/guards.isObjectRecord: SDK message content parts can
// be arrays, and this probe must admit them (guards' version excludes arrays).
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

const partField = (part: unknown, field: 'type' | 'toolCallId' | 'toolName'): string | undefined => {
  if (!isObjectRecord(part)) return undefined;
  const value = part[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const idsOfParts = (
  message: { role: string; content: unknown },
  partType: 'tool-call' | 'tool-result'
): string[] =>
  Array.isArray(message.content)
    ? message.content.filter(part => partField(part, 'type') === partType)
        .map(part => partField(part, 'toolCallId'))
        .filter((id): id is string => id !== undefined)
    : [];

const namedCallsOfMessage = (message: { role: string; content: unknown }): { id: string; name: string }[] =>
  Array.isArray(message.content)
    ? message.content
        .filter(part => partField(part, 'type') === 'tool-call')
        .map(part => ({
          id: partField(part, 'toolCallId') ?? '',
          name: partField(part, 'toolName'),
        }))
        .filter(call => call.id.length > 0 && call.name.length > 0)
    : [];

export const UNANSWERED_TOOL_ERROR_TEXT =
  'This tool call was never answered: the turn ended before an outcome was recorded. Do not assume it ran.';

const unansweredToolResult = (toolCallId: string, toolName?: string): Record<string, unknown> => ({
  type: 'tool-result',
  toolCallId,
  toolName: toolName ?? 'unknown',
  output: { type: 'error-text', value: UNANSWERED_TOOL_ERROR_TEXT },
});

export type SanitizedModelConversation<TMessage> = {
  messages: TMessage[];
  /** Results dropped because no surviving call asked for them. */
  droppedMessages: number;
  /** Calls that never got a result, now answered with an explicit error. */
  answeredTools: number;
};

/**
 * The one owner that keeps a rebuilt conversation sendable.
 *
 * Providers are stateless: a request must contain a matched pair for every tool
 * call. History rebuilt from the session log does not always — a cancelled turn, an
 * abandoned approval, or a crash between a call and its journal entry leaves one
 * side alone. Left unfixed, the whole request is rejected and the thread stops
 * working, so this is a correctness gate, not a tidy-up.
 *
 * Pairing is by `toolCallId`. The earlier rule was positional (a tool message is
 * kept if the message before it looks like a tool run), which silently accepted a
 * result attached to the wrong call and rejected a valid run split across messages.
 */
export const sanitizeModelConversationMessages = <
  TMessage extends { role: string; content: unknown },
>(
  messages: readonly TMessage[]
): SanitizedModelConversation<TMessage> => {
  // Pass one: the calls and results that exist anywhere in the conversation.
  const callIds = new Set(messages.flatMap(message =>
    message.role === 'assistant' ? idsOfParts(message, 'tool-call') : []
  ));
  const resultIds = new Set(messages.flatMap(message => idsOfParts(message, 'tool-result')));

  const sanitizedMessages: TMessage[] = [];
  let droppedMessages = 0;
  let answeredTools = 0;

  for (const message of messages) {
    if (message.role === 'tool') {
      const matched = (Array.isArray(message.content) ? message.content : []).filter(
        part => {
          if (partField(part, 'type') !== 'tool-result') return true;
          const id = partField(part, 'toolCallId');
          return id !== undefined && callIds.has(id);
        }
      );
      if (!Array.isArray(message.content)) {
        sanitizedMessages.push(message);
        continue;
      }
      if (matched.length === 0) {
        droppedMessages += 1;
        continue;
      }
      if (matched.length < (message.content as unknown[]).length) {
        droppedMessages += (message.content as unknown[]).length - matched.length;
        sanitizedMessages.push({ ...message, content: matched } as TMessage);
        continue;
      }
      sanitizedMessages.push(message);
      continue;
    }

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const calls = namedCallsOfMessage(message);
      const missing = calls.filter(call => !resultIds.has(call.id));
      sanitizedMessages.push(message);
      if (missing.length > 0) {
        answeredTools += missing.length;
        sanitizedMessages.push({
          role: 'tool',
          content: missing.map(call => unansweredToolResult(call.id, call.name)),
        } as unknown as TMessage);
      }
      continue;
    }

    sanitizedMessages.push(message);
  }

  return { messages: sanitizedMessages, droppedMessages, answeredTools };
};
