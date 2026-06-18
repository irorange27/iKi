import {
  type ChatUiMessage,
  type TextPart,
  type UiMessagePart,
  normalizeChatUiMetadataPart,
} from './message_parts';
import { isObjectRecord } from './message_parts';
import { normalizeToolPartForValidation } from './tool_parts';

export type StoredUiMessageRow = { id: string; message: string };
export type ParsedUiMessage = ChatUiMessage;

const normalizeRole = (role: unknown): ParsedUiMessage['role'] => {
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

export const sanitizeUiMessageJsonForStorage = (raw: string): string => {
  if (typeof raw !== 'string') return String(raw);
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isObjectRecord(parsed)) return raw;

    const role =
      parsed.role === 'system' || parsed.role === 'assistant' || parsed.role === 'user'
        ? parsed.role
        : null;
    if (!role) return raw;

    const sanitized: Record<string, unknown> = { role };
    const parts = Array.isArray(parsed.parts) ? parsed.parts : null;

    if (parts) {
      const nextParts = parts
        .map((part, index) => normalizePart(part, `${role}_tool_${index}`))
        .filter((part): part is UiMessagePart => part !== null);

      sanitized.parts = nextParts;
    } else if (typeof parsed.content === 'string') {
      sanitized.parts = [createTextPart(parsed.content)];
    }

    return JSON.stringify(sanitized);
  } catch {
    return raw;
  }
};

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
): ParsedUiMessage['parts'] => {
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

export const normalizeUiMessage = (
  value: unknown,
  options: {
    fallbackId: string;
    fallbackRole?: ParsedUiMessage['role'];
  }
): ParsedUiMessage | null => {
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

export const parseStoredUiMessageRow = (row: StoredUiMessageRow): ParsedUiMessage => {
  try {
    const parsed = JSON.parse(row.message);
    const normalized = normalizeUiMessage(parsed, {
      fallbackId: row.id,
      fallbackRole: 'user',
    });
    if (normalized) {
      return normalized;
    }
  } catch {
    // Fallback below.
  }

  return {
    id: row.id,
    role: 'user',
    parts: [createTextPart(row.message)],
  };
};
