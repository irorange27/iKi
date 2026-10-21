/**
 * Scripted Pi stream for tests.
 *
 * The scripted model seam for turn tests. It replaced the former
 * `FauxModelProvider` (which implemented the AI SDK's `LanguageModelV3`
 * interface and forced every turn test onto that executor); both are gone
 * (ADR 009). The only supply is Pi, whose seam is `callPiChat` returning an
 * async iterable of `AssistantMessageEvent`-shaped events plus a `result()`
 * promise.
 *
 * Script a turn with the helpers below and pass the factory to
 * `setPiChatScript(...)`, or mock `callPiChat` with it directly.
 */
import type { AssistantMessage, AssistantMessageEvent, JsonObject, Usage } from '@earendil-works/pi-ai';

export type PiScriptStep =
  /** Stream `text` as one text block. */
  | { kind: 'text'; text: string }
  /** Stream a tool call the harness is expected to execute. */
  | { kind: 'toolCall'; toolName: string; args: JsonObject; id?: string }
  /** End the turn. `reason` defaults to `stop`. */
  | {
      kind: 'done';
      reason?: 'stop' | 'length' | 'toolUse';
      /** Token accounting this call reports (drives cache-usage assertions). */
      usage?: Partial<Usage>;
    };

export type PiScript = PiScriptStep[];

// Pi's Usage carries a `totalTokens` and a `cost` breakdown; leaving them out
// made the harness read `usage.totalTokens` off undefined.
const EMPTY_USAGE: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, total: 0 },
} as Usage;

const createMessage = (
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
  usage?: Partial<Usage>
): AssistantMessage =>
  ({
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'openai',
    model: 'scripted',
    usage: { ...EMPTY_USAGE, ...(usage ?? {}) },
    stopReason,
  }) as AssistantMessage;


/** Build the events for one scripted assistant turn. */
export const piEventsForScript = (script: PiScript): AssistantMessageEvent[] => {
  const content: AssistantMessage['content'] = [];
  const events: AssistantMessageEvent[] = [];
  let index = 0;

  events.push({ type: 'start', partial: createMessage([]) } as AssistantMessageEvent);

  for (const step of script) {
    if (step.kind === 'text') {
      events.push({
        type: 'text_start',
        contentIndex: index,
        partial: createMessage([...content]),
      } as AssistantMessageEvent);
      content.push({ type: 'text', text: step.text });
      events.push({
        type: 'text_delta',
        contentIndex: index,
        delta: step.text,
        partial: createMessage([...content]),
      } as AssistantMessageEvent);
      events.push({
        type: 'text_end',
        contentIndex: index,
        content: step.text,
        partial: createMessage([...content]),
      } as AssistantMessageEvent);
      index += 1;
      continue;
    }
    if (step.kind === 'toolCall') {
      const id = step.id ?? `call_scripted_${index}`;
      const toolCall = {
        type: 'toolCall' as const,
        id,
        name: step.toolName,
        arguments: step.args,
      };
      events.push({
        type: 'toolcall_start',
        contentIndex: index,
        partial: createMessage([...content]),
      } as AssistantMessageEvent);
      content.push(toolCall);
      events.push({
        type: 'toolcall_end',
        contentIndex: index,
        toolCall,
        partial: createMessage([...content]),
      } as AssistantMessageEvent);
      index += 1;
    }
  }

  // The `done` step decides how the turn ends, and its reason must reach the
  // message too: the harness reads `result()`, whose `stopReason` is what tells
  // it the model asked for tools rather than finished.
  const doneStep = script.find(step => step.kind === 'done');
  const reason = doneStep && doneStep.kind === 'done' ? (doneStep.reason ?? 'stop') : 'stop';
  const usage = doneStep && doneStep.kind === 'done' ? doneStep.usage : undefined;
  events.push({
    type: 'done',
    reason,
    message: createMessage(content, reason as AssistantMessage['stopReason'], usage),
  } as AssistantMessageEvent);

  return events;
};

/**
 * A `callPiChat` stand-in that replays one script per invocation.
 *
 * Each model call consumes the NEXT script. Once the list is exhausted the
 * stand-in answers with a plain closing text rather than replaying an earlier
 * script: a turn's tool loop can call the model once more than the test
 * scripted, and repeating a previous reply made the harness accumulate that
 * text once per extra step (a nine-step loop produced the same sentence nine
 * times). An exhausted script is a settled turn, not a replayed one.
 */
export const createScriptedPiChat = (scripts: PiScript[]) => {
  let calls = 0;
  return ((_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) => {
    // An exhausted script is a BUG in the test, not a settled turn: replaying
    // an earlier reply hid extra model calls (a nine-step loop produced one
    // sentence nine times). Failing loudly is the only honest signal.
    if (calls >= scripts.length) {
      throw new Error(
        `scripted Pi model call #${calls + 1} has no response in queue: the turn made more model calls than the script covers`
      );
    }
    const script = scripts[calls];
    calls += 1;
    // Built per invocation, never shared: two concurrent turns each iterate
    // their own events and settle on their own message. Reusing one event array
    // let the second stream consume the first's `done` and settle with an
    // undefined usage.
    const events = piEventsForScript(script);
    const doneEvent = events[events.length - 1] as Extract<AssistantMessageEvent, { type: 'done' }>;

    const stream = {
      async *[Symbol.asyncIterator]() {
        let yielded = 0;
        for (const event of events) {
          // A real provider stream stops when the caller aborts DURING the
          // stream (steering, cancellation). Checking only after at least one
          // event is what keeps an already-settled turn from being treated as
          // aborted — a stale signal must not fail a call that never started.
          if (yielded > 0 && options?.signal?.aborted) {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            throw abort;
          }
          yielded += 1;
          yield event;
        }
      },
      result: async () => doneEvent.message,
    };
    return stream;
  }) as never;
};
