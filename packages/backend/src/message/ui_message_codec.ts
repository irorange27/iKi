import {
  type ChatUiMessage,
  type TextPart,
  type UiMessagePart,
  normalizeChatUiMetadataPart,
} from './message_parts';
import { isObjectRecord } from './message_parts';
import { normalizeToolPartForValidation } from './tool_parts';

const normalizeRole = (role: unknown): ChatUiMessage['role'] => {
  if (role === 'system' || role === 'assistant' || role === 'user') {
    return role;
  }
  return 'user';
};

const createTextPart = (text: string, state?: TextPart['state']): TextPart => ({
  type: 'text',
  text,
  ...(state ? { state } : {}),
});

const normalizePart = (
  part: unknown,
  fallbackToolCallId: string
): UiMessagePart | null => {
  if (!isObjectRecord(part) || typeof part.type !== 'string') return null;

  if (part.type === 'text' && typeof part.text === 'string') {
    return createTextPart(
      part.text,
      part.state === 'streaming' || part.state === 'done' ? part.state : undefined
    );
  }

  if (part.type === 'reasoning' && typeof part.text === 'string') {
    return {
      type: 'reasoning',
      text: part.text,
      ...(part.state === 'streaming' || part.state === 'done' ? { state: part.state } : {}),
    };
  }

  if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
    return normalizeToolPartForValidation(part, fallbackToolCallId);
  }

  const normalizedMetadataPart = normalizeChatUiMetadataPart(part);
  if (normalizedMetadataPart) {
    return normalizedMetadataPart;
  }

  return null;
};

const normalizeParts = (
  parts: unknown,
  content: unknown,
  fallbackId: string
): ChatUiMessage['parts'] => {
  if (Array.isArray(parts)) {
    const normalizedParts = parts
      .map((part, index) => normalizePart(part, `${fallbackId}_tool_${index}`))
      .filter((part): part is UiMessagePart => part !== null);

    if (normalizedParts.length > 0) {
      return normalizedParts;
    }
  }

  if (typeof content === 'string') {
    return [createTextPart(content)];
  }

  return [createTextPart('')];
};

/**
 * The codec's one entry: normalize the structured message the session log stores
 * into the ChatUiMessage shape. There is no JSON-string storage form any more —
 * the sanitizer that pre-serialized strings and the row parser that re-parsed
 * them existed to shuttle one structure through a fake `message` column, and the
 * session-log rebuild hands the object to every reader directly.
 */
export const normalizeUiMessage = (
  value: unknown,
  options: {
    fallbackId: string;
    fallbackRole?: ChatUiMessage['role'];
  }
): ChatUiMessage | null => {
  if (!isObjectRecord(value)) return null;

  const id =
    typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : options.fallbackId;

  return {
    id,
    role: normalizeRole(value.role ?? options.fallbackRole),
    ...(value.metadata !== undefined ? { metadata: value.metadata } : {}),
    parts: normalizeParts(value.parts, value.content, id),
  };
};
