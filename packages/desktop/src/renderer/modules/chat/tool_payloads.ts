import {
  getToolInput,
  getToolName,
  getToolOutput,
  isObjectRecord,
} from '@iki/backend/message/tool_parts';
import {
  parseToolInputPayload,
  parseToolOutputPayload,
  type ToolPayloadKind,
  type ToolPayloadRecord,
} from '@iki/backend/message/tool_payload_contracts';

/**
 * Renderer tool-payload seam — the only place the chat UI decodes a tool
 * part's input/output.
 *
 * It deliberately does NOT import `@iki/backend/message/tool_payloads`: that
 * module is the schema-coupled owner (zod + every tool schema, ~1.6 MB of
 * bundled source plus a Node-flavoured closure) and belongs to the backend.
 * Parsing here is decode-only: JSON-decode plus the shared kind registry from
 * `tool_payload_contracts`, no validation. Whether a payload is *valid* is the
 * executor's answer; a tool card only needs the kind it is rendering and the
 * fields it can read, and every reader here already guards field types.
 *
 * The contract lives in one place: `tool_payload_contracts` (kinds, aliases,
 * decode rules). Do not copy the registry, and do not add a schema-heavy import
 * to this file — R5 + R7 in `.dependency-cruiser.cjs` and
 * `tests/renderer/modules/chat/tool_payloads_boundary.test.ts` fail on it.
 */

/** Decoded input of a tool part: the kind it resolves to plus its payload. */
export type UiToolInputPayload =
  | { kind: ToolPayloadKind; input: ToolPayloadRecord }
  | { kind: 'unknown'; input: unknown };

/** Decoded output of a tool part: the kind it resolves to plus its payload. */
export type UiToolOutputPayload =
  | { kind: ToolPayloadKind; output: ToolPayloadRecord }
  | { kind: 'unknown'; output: unknown };

const toInputPayload = (toolName: string, value: unknown): UiToolInputPayload => {
  const parsed = parseToolInputPayload(toolName, value);
  return parsed.kind === 'unknown'
    ? { kind: 'unknown', input: parsed.payload }
    : { kind: parsed.kind, input: parsed.payload };
};

const toOutputPayload = (toolName: string, value: unknown): UiToolOutputPayload => {
  const parsed = parseToolOutputPayload(toolName, value);
  return parsed.kind === 'unknown'
    ? { kind: 'unknown', output: parsed.payload }
    : { kind: parsed.kind, output: parsed.payload };
};

type ToolPayloadPair = {
  input: UiToolInputPayload;
  output: UiToolOutputPayload;
  rawInput: unknown;
  rawOutput: unknown;
  toolName: string;
};

const UNKNOWN_PAIR: ToolPayloadPair = {
  input: { kind: 'unknown', input: undefined },
  output: { kind: 'unknown', output: undefined },
  rawInput: undefined,
  rawOutput: undefined,
  toolName: 'tool',
};

/**
 * Tool cards re-render on every streamed chunk, so decoding per part is the hot
 * cost. Part objects are treated as immutable (new content arrives as a new
 * reference), so a reference-keyed cache stays fresh — invalidated by comparing
 * the raw input/output references, the same rule the diff caches use.
 */
const payloadCache = new WeakMap<object, ToolPayloadPair>();

const getPayloadPair = (part: unknown): ToolPayloadPair => {
  if (!isObjectRecord(part)) return UNKNOWN_PAIR;

  const cached = payloadCache.get(part);
  const rawInput = getToolInput(part);
  const rawOutput = getToolOutput(part);
  const toolName = getToolName(part);

  if (
    cached &&
    cached.toolName === toolName &&
    Object.is(cached.rawInput, rawInput) &&
    Object.is(cached.rawOutput, rawOutput)
  ) {
    return cached;
  }

  const pair: ToolPayloadPair = {
    input: toInputPayload(toolName, rawInput),
    output: toOutputPayload(toolName, rawOutput),
    rawInput,
    rawOutput,
    toolName,
  };

  payloadCache.set(part, pair);
  return pair;
};

export const getParsedToolInput = (part: unknown): UiToolInputPayload => getPayloadPair(part).input;

export const getParsedToolOutput = (part: unknown): UiToolOutputPayload =>
  getPayloadPair(part).output;
