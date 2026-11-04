

export type ModelToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown }
  | { type: 'content'; value: unknown }
  | { type: 'execution-denied'; reason?: string };

const TOOL_RESULT_DENIED_TEXT = 'Tool call execution denied.';

const CONTENT_PART_SEPARATOR = '';

/**
 * One home for projecting a ToolResultOutput union into wire text + isError.
 *
 * - `strict` (provider projection): an unknown type or malformed content part
 *   throws, because a silently-flattened output would corrupt the request.
 * - `lenient` (history/display): unknown shapes fall back to JSON.stringify,
 *   because a projection failure must not lose an already-persisted result.
 */
export const toolResultToWire = (
  output: unknown,
  mode: 'strict' | 'lenient'
): { text: string; isError: boolean } => {
  const fail = (message: string): never => {
    if (mode === 'strict') throw new Error(message);
    return message as never;
  };
  const stringify = (value: unknown): string => JSON.stringify(value ?? null);

  if (output === null || typeof output !== 'object' || !('type' in output)) {
    if (mode === 'strict') {
      throw new Error('tool-result output must be a typed AI SDK output');
    }
    return { text: stringify(output), isError: false };
  }

  const o = output as { type: string; value?: unknown; reason?: unknown };
  switch (o.type) {
    case 'text':
    case 'error-text':
      return { text: typeof o.value === 'string' ? o.value : stringify(o.value), isError: o.type === 'error-text' };
    case 'json':
      return { text: stringify(o.value), isError: false };
    case 'error-json':
      return { text: stringify(o.value), isError: true };
    case 'execution-denied':
      return {
        text: typeof o.reason === 'string' ? o.reason : TOOL_RESULT_DENIED_TEXT,
        isError: true,
      };
    case 'content': {
      if (!Array.isArray(o.value)) {
        return fail('content tool-result output must be a part array');
      }
      const texts: string[] = [];
      for (const part of o.value) {
        const p = part as { type?: unknown; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') {
          texts.push(p.text);
          continue;
        }
        return fail(`unsupported tool-result content part: ${String(p.type ?? typeof part)}`);
      }
      return { text: texts.join(CONTENT_PART_SEPARATOR), isError: false };
    }
    default:
      if (mode === 'strict') {
        throw new Error(`unsupported tool-result output type: ${String(o.type)}`);
      }
      return { text: stringify(o.value), isError: false };
  }
};

/** Lenient projection for history mirroring and display surfaces. */
export const toolResultText = (output: unknown): string => toolResultToWire(output, 'lenient').text;

export const toolResultIsError = (output: unknown): boolean =>
  toolResultToWire(output, 'lenient').isError;

const KNOWN_OUTPUT_TYPES = new Set(['text', 'json', 'error-text', 'content', 'execution-denied']);

/**
 * Owner of raw-value → ToolResultOutput normalization: strings become text
 * parts, known typed outputs pass through, everything else is JSON-serialized
 * into a json part. Every executor that turns a raw tool return into a wire
 * output must go through here.
 */
export const normalizeToolOutput = (output: unknown): unknown => {
  if (typeof output === 'string') return { type: 'text', value: output };
  if (
    output &&
    typeof output === 'object' &&
    typeof (output as { type?: unknown }).type === 'string' &&
    KNOWN_OUTPUT_TYPES.has((output as { type: string }).type)
  ) {
    return output;
  }
  return { type: 'json', value: JSON.parse(JSON.stringify(output ?? null)) as unknown };
};


type ModelToolResultContentPart = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: unknown;
  [key: string]: unknown;
};

type ModelToolCallContentPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  [key: string]: unknown;
};

export type ModelContentPart =
  | ModelToolResultContentPart
  | ModelToolCallContentPart
  | { type: string; [key: string]: unknown };

export type ModelMessage =
  | { role: 'system'; content: string | ModelContentPart[] }
  | { role: 'user'; content: string | ModelContentPart[] }
  | { role: 'assistant'; content: string | ModelContentPart[] }

  | { role: 'tool'; content: ModelContentPart[] };

export const cloneModelMessages = (messages?: ModelMessage[]): ModelMessage[] => {
  if (!messages || messages.length === 0) {
    return [];
  }

  return structuredClone(messages);
};

export const appendUserPromptToHistory = (
  history: ModelMessage[],
  prompt: string
): ModelMessage[] => [
  ...history,
  {
    role: 'user',
    content: prompt,
  },
];

export type ToolApprovalResponse = {

  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
};
