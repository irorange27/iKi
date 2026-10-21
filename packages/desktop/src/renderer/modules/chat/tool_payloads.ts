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

export type UiToolInputPayload =
  | { kind: ToolPayloadKind; input: ToolPayloadRecord }
  | { kind: 'unknown'; input: unknown };

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
