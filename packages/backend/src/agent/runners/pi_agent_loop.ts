import type { AssistantMessage, Message as PiMessage, Tool as PiTool } from '@earendil-works/pi-ai';

/**
 * The iKi-owned agent loop over the Pi supply layer (switch item 2a,
 * UNWIRED). Semantics are pinned against the existing harness:
 *
 * - one model call = one step; the step budget (maxSteps) bounds calls;
 * - tool calls in ANY step — including the last — execute (the harness
 *   semantics: stopWhen stops AFTER the step's tools ran);
 * - when the budget exhausts with pending tool calls, the turn ends
 *   budget-exhausted: effects were executed and recorded, but no further
 *   model call happens and the pending calls are reported (D7–D8: the
 *   exhausted budget terminates the request);
 * - cancellation is checked before each model call and before each effect;
 * - usage accumulates in raw Pi buckets — the mapping to iKi's
 *   total-prompt convention is linear, so the caller may map the sum
 *   (projectUsageToIki) or map per step and add.
 *
 * The model call is injected: wiring hands this loop the Pi adapter's
 * callPiChat; tests hand a scripted double. This module owns ORCHESTRATION
 * only — protocol, history projection and tool ownership stay with their
 * modules.
 */

export type PiLoopToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type PiLoopStep = {
  index: number;
  text: string;
  toolCalls: PiLoopToolCall[];
  usage: PiUsageBuckets;
};

export type PiUsageBuckets = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
};

export type PiLoopEvent =
  | { type: 'text_delta'; delta: string; step: number }
  | { type: 'step_end'; step: PiLoopStep };

export type PiLoopOutcome = {
  status: 'completed' | 'budget-exhausted';
  finalText: string;
  steps: PiLoopStep[];
  usage: PiUsageBuckets;
  /** Tool calls that were produced but not executed (budget exhaustion). */
  pendingToolCalls: PiLoopToolCall[];
};

export type PiLoopModelCall = (context: {
  systemPrompt: string;
  messages: PiMessage[];
  tools?: PiTool[];
}) => Promise<{ final: AssistantMessage; deltas: string[] }>;

export type PiLoopToolExecutor = (
  call: PiLoopToolCall
) => Promise<{ text: string; isError?: boolean }>;

const EMPTY_USAGE: PiUsageBuckets = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
};

const addUsage = (a: PiUsageBuckets, b: PiUsageBuckets): PiUsageBuckets => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  reasoning: a.reasoning + b.reasoning,
  totalTokens: a.totalTokens + b.totalTokens,
});

const usageOf = (message: AssistantMessage): PiUsageBuckets => ({
  input: message.usage?.input ?? 0,
  output: message.usage?.output ?? 0,
  cacheRead: message.usage?.cacheRead ?? 0,
  cacheWrite: message.usage?.cacheWrite ?? 0,
  reasoning: message.usage?.reasoning ?? 0,
  totalTokens: message.usage?.totalTokens ?? 0,
});

export const runPiAgentLoop = async (params: {
  systemPrompt: string;
  messages: PiMessage[];
  tools?: PiTool[];
  maxSteps: number;
  callModel: PiLoopModelCall;
  executeTool: PiLoopToolExecutor;
  signal?: AbortSignal;
  onEvent?: (event: PiLoopEvent) => void;
}): Promise<PiLoopOutcome> => {
  const { callModel, executeTool, signal, onEvent } = params;
  const maxSteps = Math.max(1, Math.trunc(params.maxSteps));
  const messages: PiMessage[] = [...params.messages];
  const steps: PiLoopStep[] = [];
  let usage = { ...EMPTY_USAGE };
  let lastText = '';

  for (let index = 0; index < maxSteps; index++) {
    signal?.throwIfAborted();
    const { final, deltas } = await callModel({
      systemPrompt: params.systemPrompt,
      messages: [...messages],
      tools: params.tools,
    });
    for (const delta of deltas) onEvent?.({ type: 'text_delta', delta, step: index });

    const text = final.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('');
    const toolCalls = final.content
      .filter(
        (block): block is { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } =>
          block.type === 'toolCall'
      )
      .map(block => ({ id: block.id, name: block.name, arguments: block.arguments }));

    const stepUsage = usageOf(final);
    usage = addUsage(usage, stepUsage);
    const step: PiLoopStep = { index, text, toolCalls, usage: stepUsage };
    steps.push(step);
    onEvent?.({ type: 'step_end', step });
    lastText = text;

    if (toolCalls.length === 0) {
      return { status: 'completed', finalText: text, steps, usage, pendingToolCalls: [] };
    }

    // Tools in ANY step execute — including the last (harness semantics).
    // The results ride the transcript; the budget decides whether another
    // model call follows.
    for (const call of toolCalls) {
      signal?.throwIfAborted();
      const result = await executeTool(call);
      messages.push(final);
      messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: result.text }],
        isError: result.isError ?? false,
        timestamp: Date.now(),
      });
    }

    if (index === maxSteps - 1) {
      return {
        status: 'budget-exhausted',
        finalText: lastText,
        steps,
        usage,
        pendingToolCalls: steps.at(-1)?.toolCalls ?? [],
      };
    }
  }

  // Unreachable: the loop returns inside the last iteration.
  return { status: 'budget-exhausted', finalText: lastText, steps, usage, pendingToolCalls: [] };
};
