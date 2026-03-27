import {
  createAffectSignalPart,
  createContextReportPart,
  createMemoryPart,
  createSkillUsagePart,
  type ChatUiMessage,
  type TextPart,
  type UiMessagePart,
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

  if (part.type === 'data-memory-retrieval' && isObjectRecord(part.data)) {
    return createMemoryPart(part.data);
  }
  if (part.type === 'memory-retrieval') {
    return createMemoryPart({
      ...(typeof part.query === 'string' ? { query: part.query } : {}),
      ...(Array.isArray(part.results) ? { results: part.results } : {}),
    });
  }

  if (part.type === 'data-skill-usage' && isObjectRecord(part.data)) {
    return createSkillUsagePart(part.data);
  }
  if (part.type === 'skill-usage') {
    return createSkillUsagePart({
      ...(part.mode === 'manual' || part.mode === 'auto' ? { mode: part.mode } : {}),
      ...(Array.isArray(part.skills) ? { skills: part.skills } : {}),
    });
  }

  if (part.type === 'data-affect-signal' && isObjectRecord(part.data)) {
    return createAffectSignalPart(part.data);
  }
  if (part.type === 'affect-signal') {
    return createAffectSignalPart({
      ...(part.source === 'history' || part.source === 'realtime' ? { source: part.source } : {}),
      ...(typeof part.guardActive === 'boolean' ? { guardActive: part.guardActive } : {}),
      ...(typeof part.label === 'string' ? { label: part.label } : {}),
      ...(typeof part.confidence === 'number' ? { confidence: part.confidence } : {}),
      ...(typeof part.valence === 'number' ? { valence: part.valence } : {}),
      ...(typeof part.arousal === 'number' ? { arousal: part.arousal } : {}),
      ...(Array.isArray(part.emotions) ? { emotions: part.emotions } : {}),
      ...(typeof part.sampleCount === 'number' ? { sampleCount: part.sampleCount } : {}),
      ...(typeof part.windowSize === 'number' ? { windowSize: part.windowSize } : {}),
      ...(typeof part.startAt === 'string' ? { startAt: part.startAt } : {}),
      ...(typeof part.endAt === 'string' ? { endAt: part.endAt } : {}),
      ...(typeof part.ageMinutes === 'number' ? { ageMinutes: part.ageMinutes } : {}),
      ...(typeof part.windowMinutes === 'number' ? { windowMinutes: part.windowMinutes } : {}),
    });
  }

  if (part.type === 'data-context-report' && isObjectRecord(part.data)) {
    return createContextReportPart(part.data);
  }
  if (part.type === 'context-report') {
    return createContextReportPart({
      ...(typeof part.totalEstimatedTokens === 'number'
        ? { totalEstimatedTokens: part.totalEstimatedTokens }
        : {}),
      ...(typeof part.retainedRecentMessages === 'number'
        ? { retainedRecentMessages: part.retainedRecentMessages }
        : {}),
      ...(typeof part.compactedMessages === 'number'
        ? { compactedMessages: part.compactedMessages }
        : {}),
      ...(Array.isArray(part.blocks) ? { blocks: part.blocks } : {}),
    });
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
