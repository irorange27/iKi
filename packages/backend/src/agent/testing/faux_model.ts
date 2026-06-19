import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3GenerateResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

// ── Scripted response ──────────────────────────────────────────────

export interface FauxResponse {
  /** Raw provider stream parts to emit, in order. */
  parts: LanguageModelV3StreamPart[];
}

// ── Zero usage ─────────────────────────────────────────────────────

const ZERO_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// ── Faux model ─────────────────────────────────────────────────────

/**
 * In-memory LLM provider that consumes a queue of scripted
 * {@link FauxResponse} objects. Each call to `doStream` or `doGenerate`
 * pops the next response from the queue.
 *
 * Designed for integration testing agent turns without real API calls.
 */
export class FauxModelProvider implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'faux';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private queue: FauxResponse[];

  constructor(responses: FauxResponse[], modelId = 'faux-model') {
    this.queue = [...responses];
    this.modelId = modelId;
  }

  doGenerate(
    _options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const response = this._next();
    const content = this._partsToContent(response.parts);
    const finishPart = response.parts[response.parts.length - 1];
    const finishReason =
      finishPart?.type === 'finish'
        ? finishPart.finishReason
        : { unified: 'stop' as const, raw: 'stop' };

    return Promise.resolve({
      content,
      finishReason,
      usage: ZERO_USAGE,
      warnings: [],
    });
  }

  doStream(
    _options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const response = this._next();

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of response.parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });

    return Promise.resolve({ stream });
  }

  // ── Queue ──────────────────────────────────────────────────────

  /** Append more responses after construction (e.g. for turn 2). */
  enqueue(...responses: FauxResponse[]): void {
    this.queue.push(...responses);
  }

  /** How many responses remain in the queue. */
  get remaining(): number {
    return this.queue.length;
  }

  // ── Internal ───────────────────────────────────────────────────

  private _next(): FauxResponse {
    const response = this.queue.shift();
    if (!response) {
      throw new Error('FauxModelProvider: no more responses in queue');
    }
    return response;
  }

  /** Crude stream-part → content conversion for doGenerate fallback. */
  private _partsToContent(
    parts: LanguageModelV3StreamPart[],
  ): LanguageModelV3GenerateResult['content'] {
    const content: LanguageModelV3GenerateResult['content'] = [];
    let currentText = '';
    let textId = '';

    for (const part of parts) {
      if (part.type === 'text-start') {
        textId = part.id;
        currentText = '';
      } else if (part.type === 'text-delta' && part.id === textId) {
        currentText += part.delta;
      } else if (part.type === 'text-end' && part.id === textId) {
        content.push({ type: 'text', text: currentText });
      } else if (part.type === 'tool-call') {
        content.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
      } else if (part.type === 'finish') {
        // ignore — finish reason handled at top level
      }
    }

    return content;
  }
}

// ── Response builders ───────────────────────────────────────────────

let _nextId = 0;
const uid = (prefix: string): string => `${prefix}-${++_nextId}`;

/** Build a minimal text-only response. */
export function fauxText(text: string, opts?: { finishReason?: string }): FauxResponse {
  const id = uid('txt');
  const parts: LanguageModelV3StreamPart[] = [
    { type: 'text-start', id },
    { type: 'text-delta', id, delta: text },
    { type: 'text-end', id },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: opts?.finishReason ?? 'stop' },
      usage: ZERO_USAGE,
    },
  ];
  return { parts };
}

/** Build a response that emits a single tool call. */
export function fauxToolCall(
  toolName: string,
  input: Record<string, unknown>,
  opts?: { id?: string; textBefore?: string },
): FauxResponse {
  const parts: LanguageModelV3StreamPart[] = [];

  if (opts?.textBefore) {
    const tid = uid('txt');
    parts.push(
      { type: 'text-start', id: tid },
      { type: 'text-delta', id: tid, delta: opts.textBefore },
      { type: 'text-end', id: tid },
    );
  }

  const toolId = opts?.id ?? uid('tool');

  parts.push(
    {
      type: 'tool-call',
      toolCallId: toolId,
      toolName,
      input: JSON.stringify(input),
    } satisfies LanguageModelV3StreamPart,
    {
      type: 'tool-input-end',
      id: toolId,
    } satisfies LanguageModelV3StreamPart,
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: ZERO_USAGE,
    },
  );

  return { parts };
}
