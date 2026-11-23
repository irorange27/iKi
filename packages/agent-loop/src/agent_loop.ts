import type { AssistantMessage, Message as LlmMessage, Tool as LlmTool, ToolCall } from '@earendil-works/pi-ai';
import type { AgentHooks } from '@iki/agent/types';
import { toolResultIsError, toolResultText } from '@iki/llm/message/model_history';

export { toolResultText, toolResultIsError };

export type LoopTool = LlmTool;

export type LoopToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LoopStep = {
  index: number;
  text: string;
  thinking: string;
  toolCalls: LoopToolCall[];
  usage: LoopUsageBuckets;
};

export type LoopUsageBuckets = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  costUsd: number;
};

export enum LoopEventType {
  TextDelta = 'text_delta',
  ThinkingDelta = 'thinking_delta',
  StepEnd = 'step_end',
  ToolStart = 'tool_start',
  ToolEnd = 'tool_end',
}

export type LoopEvent =
  | { type: LoopEventType.TextDelta; delta: string; step: number }
  | { type: LoopEventType.ThinkingDelta; delta: string; step: number }
  | { type: LoopEventType.StepEnd; step: LoopStep }
  | { type: LoopEventType.ToolStart; call: LoopToolCall }
  | {
      type: LoopEventType.ToolEnd;
      call: LoopToolCall;
      output: unknown;
    };

export type LoopOutcome = {
  status: 'completed' | 'budget-exhausted';
  finalText: string;
  steps: LoopStep[];
  usage: LoopUsageBuckets;
};

export type LoopDelta = {
  type: 'text_delta' | 'thinking_delta';
  delta: string;
};

export type LoopModelCall = (context: {
  systemPrompt: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  steps: ReadonlyArray<LoopStep>;
}) =>
  | {
      events: AsyncIterable<LoopDelta>;
      final: Promise<AssistantMessage>;
    }
  | Promise<{
      events: AsyncIterable<LoopDelta>;
      final: Promise<AssistantMessage>;
    }>;

type LoopToolExecutor = (call: LoopToolCall) => Promise<unknown>;

const EMPTY_USAGE: LoopUsageBuckets = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
  costUsd: 0,
};

const addUsage = (a: LoopUsageBuckets, b: LoopUsageBuckets): LoopUsageBuckets => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  reasoning: a.reasoning + b.reasoning,
  totalTokens: a.totalTokens + b.totalTokens,
  costUsd: a.costUsd + b.costUsd,
});

const usageOf = (message: AssistantMessage): LoopUsageBuckets => ({
  input: message.usage?.input ?? 0,
  output: message.usage?.output ?? 0,
  cacheRead: message.usage?.cacheRead ?? 0,
  cacheWrite: message.usage?.cacheWrite ?? 0,
  reasoning: message.usage?.reasoning ?? 0,
  totalTokens: message.usage?.totalTokens ?? 0,
  costUsd: message.usage?.cost?.total ?? 0,
});

export const runAgentLoop = async function* (
  params: {
    systemPrompt: string;
    messages: LlmMessage[];
    tools?: LoopTool[];
    maxSteps: number;
    terminalToolNames?: ReadonlySet<string>;
    callModel: LoopModelCall;
    executeTool: LoopToolExecutor;
    signal?: AbortSignal;
    hooks?: AgentHooks<LlmMessage, LoopToolCall, LoopStep, LoopOutcome>;
    onModelCall?: (settled: {
      step: number;
      text: string;
      toolCallCount: number;
      usage: LoopUsageBuckets;
    }) => void;
  }
): AsyncGenerator<LoopEvent, LoopOutcome> {
  const { callModel, executeTool, signal, terminalToolNames, hooks, onModelCall } = params;
  const maxSteps = Number.isFinite(params.maxSteps) ? Math.max(1, Math.trunc(params.maxSteps)) : 1;
  const messages: LlmMessage[] = params.messages;
  const steps: LoopStep[] = [];
  let usage = { ...EMPTY_USAGE };
  let lastText = '';

  await hooks?.preTurn?.({ systemPrompt: params.systemPrompt, messages });

  for (let index = 0; index < maxSteps; index++) {
    signal?.throwIfAborted();
    await hooks?.preStep?.({ step: index, systemPrompt: params.systemPrompt, messages });

    const call = await callModel({
      systemPrompt: params.systemPrompt,
      messages,
      tools: params.tools,
      steps,
    });
    for await (const delta of call.events) {
      if (delta.type === 'text_delta') {
        yield { type: LoopEventType.TextDelta, delta: delta.delta, step: index };
        continue;
      }
      yield { type: LoopEventType.ThinkingDelta, delta: delta.delta, step: index };
    }
    const final = await call.final;

    if (final.stopReason === 'aborted') {
      throw new DOMException(final.errorMessage || 'Run cancelled', 'AbortError');
    }
    if (final.stopReason === 'error') {
      throw new Error(final.errorMessage || 'Provider returned an error stop reason');
    }

    const text = final.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('');
    const thinking = final.content
      .filter((block): block is { type: 'thinking'; thinking: string } => block.type === 'thinking')
      .map(block => block.thinking)
      .join('');
    const toolCalls = final.content
      .filter((block): block is ToolCall => block.type === 'toolCall')
      .map(block => ({ id: block.id, name: block.name, arguments: block.arguments }));

    const stepUsage = usageOf(final);
    usage = addUsage(usage, stepUsage);
    const step: LoopStep = { index, text, thinking, toolCalls, usage: stepUsage };
    steps.push(step);

    onModelCall?.({
      step: index,
      text,
      toolCallCount: toolCalls.length,
      usage: stepUsage,
    });
    await hooks?.postStep?.(step);
    yield { type: LoopEventType.StepEnd, step };
    lastText = text;

    if (toolCalls.length === 0) {
      const outcome: LoopOutcome = { status: 'completed', finalText: text, steps, usage };
      await hooks?.postTurn?.(outcome);
      return outcome;
    }

    messages.push(final);

    for (const call of toolCalls) {
      signal?.throwIfAborted();
      const clonedCall: LoopToolCall = { ...call, arguments: structuredClone(call.arguments) };
      await hooks?.preTool?.(clonedCall);
      yield { type: LoopEventType.ToolStart, call };

      let output = await executeTool(clonedCall);
      if (hooks?.postTool) {
        const transformed = await hooks.postTool(clonedCall, output);
        if (transformed !== undefined) output = transformed;
      }
      yield { type: LoopEventType.ToolEnd, call, output };
      messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: toolResultText(output) }],
        isError: toolResultIsError(output),
        timestamp: Date.now(),
      });
    }

    if (toolCalls.some(call => terminalToolNames?.has(call.name))) {
      const outcome: LoopOutcome = { status: 'completed', finalText: lastText, steps, usage };
      await hooks?.postTurn?.(outcome);
      return outcome;
    }

    if (index === maxSteps - 1) {
      const outcome: LoopOutcome = { status: 'budget-exhausted', finalText: lastText, steps, usage };
      await hooks?.postTurn?.(outcome);
      return outcome;
    }
  }

  const outcome: LoopOutcome = { status: 'budget-exhausted', finalText: lastText, steps, usage };
  await hooks?.postTurn?.(outcome);
  return outcome;
};
