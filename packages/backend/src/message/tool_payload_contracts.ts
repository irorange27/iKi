import { isObjectRecord } from '@iki/backend/utils/guards';

import { normalizeToolNameKey } from './tool_parts/normalize';
import { parseMaybeJson } from './tool_parts/parse';

export type ToolPayloadKind =
  | 'web'
  | 'fetch'
  | 'shell'
  | 'read_file'
  | 'write_file'
  | 'edit'
  | 'delete_file'
  | 'load_skill'
  | 'list_personal_skills'
  | 'read_personal_skill'
  | 'write_personal_skill'
  | 'delete_personal_skill'
  | 'agent'
  | 'list_awaiters'
  | 'read_awaiter'
  | 'write_awaiter'
  | 'delete_awaiter';

export type ToolPayloadRecord = Record<string, unknown>;

export type ParsedToolPayload =
  | { kind: ToolPayloadKind; payload: ToolPayloadRecord }
  | { kind: 'unknown'; payload: unknown };

export type ToolPayloadValidator = (kind: ToolPayloadKind, normalizedValue: unknown) => unknown;

const TOOL_PAYLOAD_KINDS = {
  web: true,
  fetch: true,
  shell: true,
  read_file: true,
  write_file: true,
  edit: true,
  delete_file: true,
  load_skill: true,
  list_personal_skills: true,
  read_personal_skill: true,
  write_personal_skill: true,
  delete_personal_skill: true,
  agent: true,
  list_awaiters: true,
  read_awaiter: true,
  write_awaiter: true,
  delete_awaiter: true,
} satisfies Record<ToolPayloadKind, true>;

const TOOL_PAYLOAD_ALIASES: Record<string, ToolPayloadKind> = {
  web_search: 'web',
};

export const resolveToolPayloadKind = (toolName: string): ToolPayloadKind | null => {
  const toolKey = normalizeToolNameKey(toolName);
  if (Object.prototype.hasOwnProperty.call(TOOL_PAYLOAD_KINDS, toolKey)) {
    return toolKey as ToolPayloadKind;
  }
  return TOOL_PAYLOAD_ALIASES[toolKey] ?? null;
};

const parseToolPayload = (
  toolName: string,
  value: unknown,
  normalize: (value: unknown) => unknown,
  validate?: ToolPayloadValidator
): ParsedToolPayload => {
  const kind = resolveToolPayloadKind(toolName);
  if (!kind) return { kind: 'unknown', payload: value };

  const normalizedValue = normalize(value);

  if (validate) {
    const validated = validate(kind, normalizedValue);

    if (validated === null || !isObjectRecord(validated)) {
      return { kind: 'unknown', payload: value };
    }
    return { kind, payload: validated };
  }

  return isObjectRecord(normalizedValue)
    ? { kind, payload: normalizedValue }
    : { kind: 'unknown', payload: value };
};

export const parseToolInputPayload = (
  toolName: string,
  value: unknown,
  validate?: ToolPayloadValidator
): ParsedToolPayload =>
  parseToolPayload(
    toolName,
    value,

    raw => (typeof raw === 'string' ? parseMaybeJson(raw) : raw),
    validate
  );

export const parseToolOutputPayload = (
  toolName: string,
  value: unknown,
  validate?: ToolPayloadValidator
): ParsedToolPayload => parseToolPayload(toolName, value, parseMaybeJson, validate);
