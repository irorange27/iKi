import { isObjectRecord } from '@iki/backend/utils/guards';

import { normalizeToolNameKey } from './tool_parts/normalize';
import { parseMaybeJson } from './tool_parts/parse';

/**
 * Browser-safe tool-payload contract — the schemas-free half of tool payload
 * parsing.
 *
 * It owns the kind registry, the aliases, the decode rules and the parsing
 * kernels. It must stay free of `@iki/backend/tools/schemas` and zod: those are
 * server-side validation machinery (zod + every tool schema, ~1.6 MB of bundled
 * source) and anything that imports them lands in the production renderer
 * bundle. Schema-backed validation lives in `./tool_payloads.ts`, which wraps
 * these kernels with a validator; the desktop renderer calls them without one.
 *
 * Enforced by R5 (direct renderer→backend imports) and R7 (renderer→backend
 * reachability) in `.dependency-cruiser.cjs`. Do not add a schema-heavy import
 * here, and do not copy this registry into another module — one owner.
 */

/** Tool kinds with a UI payload shape — mirrors the tool schema registry keys. */
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
  | 'todo'
  | 'agent'
  | 'list_awaiters'
  | 'read_awaiter'
  | 'write_awaiter'
  | 'delete_awaiter'
  | 'list_todo_lists'
  | 'read_todo_list'
  | 'write_todo_list'
  | 'delete_todo_list'
  | 'list_proactive_tasks'
  | 'read_proactive_task'
  | 'write_proactive_task'
  | 'delete_proactive_task';

/** A decoded payload whose shape was accepted: always a plain object record. */
export type ToolPayloadRecord = Record<string, unknown>;

export type ParsedToolPayload =
  | { kind: ToolPayloadKind; payload: ToolPayloadRecord }
  | { kind: 'unknown'; payload: unknown };

/**
 * Optional validator the kernels delegate to. Return the value to publish as
 * the payload, or `null` to reject it — rejection reports the payload as
 * `unknown` and keeps the original (undecoded) value, same as before this split.
 *
 * `./tool_payloads.ts` passes a zod-backed validator. Callers that only need
 * the kind plus the decoded object (the renderer) pass nothing.
 */
export type ToolPayloadValidator = (kind: ToolPayloadKind, normalizedValue: unknown) => unknown;

// `satisfies` keeps this registry and the ToolPayloadKind union in lockstep: a
// kind added to one and not the other is a compile error, so they cannot
// silently drift apart the way a duplicated table would.
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
  todo: true,
  agent: true,
  list_awaiters: true,
  read_awaiter: true,
  write_awaiter: true,
  delete_awaiter: true,
  list_todo_lists: true,
  read_todo_list: true,
  write_todo_list: true,
  delete_todo_list: true,
  list_proactive_tasks: true,
  read_proactive_task: true,
  write_proactive_task: true,
  delete_proactive_task: true,
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
    // Every tool schema produces an object, so a non-null validated payload is
    // always a record; the guard keeps that contract explicit.
    if (validated === null || !isObjectRecord(validated)) {
      return { kind: 'unknown', payload: value };
    }
    return { kind, payload: validated };
  }

  // Decode-only: a kind is asserted only when the decoded payload is a plain
  // object — the shape the UI readers can consume. Anything else (a string that
  // is not JSON, a number, an array) stays `unknown` with the original value,
  // which is also what schema validation used to conclude for those inputs.
  return isObjectRecord(normalizedValue)
    ? { kind, payload: normalizedValue }
    : { kind: 'unknown', payload: value };
};

/** Decode a tool input; strings are JSON-decoded, objects pass through. */
export const parseToolInputPayload = (
  toolName: string,
  value: unknown,
  validate?: ToolPayloadValidator
): ParsedToolPayload =>
  parseToolPayload(
    toolName,
    value,
    // Input normalization is unchanged by this split: a string is decoded (and
    // left as-is when it is not JSON); a non-string stays raw, so primitives
    // never silently turn into an empty payload object.
    raw => (typeof raw === 'string' ? parseMaybeJson(raw) : raw),
    validate
  );

/** Decode a tool output; the value is JSON-decoded whether it is a string or not. */
export const parseToolOutputPayload = (
  toolName: string,
  value: unknown,
  validate?: ToolPayloadValidator
): ParsedToolPayload => parseToolPayload(toolName, value, parseMaybeJson, validate);
