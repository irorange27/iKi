
import type { AssistantMessage, AssistantMessageEvent, JsonObject, Usage } from '@earendil-works/pi-ai';

export type PiScriptStep =

  | { kind: 'text'; text: string }

  | { kind: 'toolCall'; toolName: string; args: JsonObject; id?: string }

  | {
      kind: 'done';
      reason?: 'stop' | 'length' | 'toolUse';

      usage?: Partial<Usage>;
    };

export type PiScript = PiScriptStep[];

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

const piEventsForScript = (script: PiScript): AssistantMessageEvent[] => {
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

export const createScriptedPiChat = (scripts: PiScript[]) => {
  let calls = 0;
  return ((_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) => {

    if (calls >= scripts.length) {
      throw new Error(
        `scripted Pi model call #${calls + 1} has no response in queue: the turn made more model calls than the script covers`
      );
    }
    const script = scripts[calls];
    calls += 1;

    const events = piEventsForScript(script);
    const doneEvent = events[events.length - 1] as Extract<AssistantMessageEvent, { type: 'done' }>;

    const stream = {
      async *[Symbol.asyncIterator]() {
        let yielded = 0;
        for (const event of events) {

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
