/**
 * Core transcript message types — unified across UI ↔ persistence ↔ provider boundary.
 *
 * Before this change, iKi had four message types that lived in different layers:
 *   ChatUiMessage (UI parts with dynamic-tool states), ModelMessage (projected to model),
 *   LlmChatMessage (text-only provider wire), ChatInputMessage (=alias for ModelMessage).
 *
 * The intermediate conversions caused bugs: a 'dynamic-tool' part could leak into the model,
 * or approval requests could be lost between layers. Now there is ONE record type used
 * everywhere: ModelMessage. When sending to providers we project string-only content;
 * when persisting/replaying we keep the full structure.
 */

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
 * Project a ToolResultOutput into wire text + isError for display.
 *
 * - strict mode (used by provider path): throws on unknown shapes because a silently-flattened output corrupts the request.
 * - lenient mode (used by history/display): falls back to JSON.stringify so a projection failure never loses already-persisted results.
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
    if (mode === 'strict') throw new Error('tool-result output must be a typed AI SDK output');
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
      return { text: typeof o.reason === 'string' ? o.reason : TOOL_RESULT_DENIED_TEXT, isError: true };
    case 'content': {
      if (!Array.isArray(o.value)) return fail('content tool-result output must be a part array');
      const texts: string[] = [];
      for (const part of o.value) {
        const p = part as { type?: unknown; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') { texts.push(p.text); continue; }
        return fail(`unsupported tool-result content part: ${String(p.type ?? typeof part)}`);
      }
      return { text: texts.join(CONTENT_PART_SEPARATOR), isError: false };
    }
    default:
      if (mode === 'strict') throw new Error(`unsupported tool-result output type: ${String(o.type)}`);
      return { text: stringify(o.value), isError: false };
  }
};

/** Lenient projection for history mirroring and display surfaces. */
export const toolResultText = (output: unknown): string => toolResultToWire(output, 'lenient').text;
export const toolResultIsError = (output: unknown): boolean => toolResultToWire(output, 'lenient').isError;

const KNOWN_OUTPUT_TYPES = new Set(['text', 'json', 'error-text', 'content', 'execution-denied']);

/**
 * Normalize raw tool returns to ToolResultOutput union. Strings become text parts;
 * known typed outputs pass through unchanged; everything else gets JSON-serialized.
 * Every executor that turns a raw tool return into a wire output must go through here.
 */
export const normalizeToolOutput = (output: unknown): unknown => {
  if (typeof output === 'string') return { type: 'text', value: output };
  if (
    output &&
    typeof output === 'object' &&
    typeof (output as { type?: unknown }).type === 'string' &&
    KNOWN_OUTPUT_TYPES.has((output as { type: string }).type)
  ) return output;
  return { type: 'json', value: JSON.parse(JSON.stringify(output ?? null)) as unknown };
};

/**
 * Single source of truth for all message types: one union covering system/user/assistant/tool roles.
 * Content can be a plain string (for wire/text views) OR an array of concrete parts (for persistence/UI).
 */
export type ModelMessage =
  | { role: 'system'; content: string | ModelContentPart[] }
  | { role: 'user'; content: string | ModelContentPart[] }
  | { role: 'assistant'; content: string | ModelContentPart[] }
  | { role: 'tool'; content: ModelContentPart[] };

/**
 * Concrete part types inside a message's content array. These replace the old
 * nested ToolResultContentPart/ToolCallContentPart union plus a catch-all string part.
 */
export type ModelContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'file'; url: string; mediaType: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input?: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output?: unknown }
  | { type: string; [key: string]: unknown }; // Catch-all for future extensions (e.g. data-* parts)

/** Deep copy for persisted snapshots. Safe because ModelMessage contains no circular references. */
export const cloneModelMessages = (messages?: ModelMessage[]): ModelMessage[] => {
  if (!messages || messages.length === 0) return [];
  return structuredClone(messages);
};

/** Append a user prompt to existing history. Pure convenience helper. */
export const appendUserPromptToHistory = (history: ModelMessage[], prompt: string): ModelMessage[] => [
  ...history,
  { role: 'user', content: prompt },
];

/** Extract visible text from any message content (strings or part arrays). Used for previews/snippets. */
export const extractTextFromModelMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(part => {
      if (typeof part !== 'object' || part === null || !('type' in part)) return false;
      const p = part as { type: string; text?: string };
      return p.type === 'text' && typeof p.text === 'string';
    })
    .map(part => (part as { text: string }).text)
    .join('');
};

/**
 * Data structure for collecting and persisting user approval decisions.
 * Used by the approval session to accumulate responses until a decision is made,
 * then persisted to the session log as APPROVAL_DECIDED events.
 */
export type ToolApprovalResponse = {
  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
};
