import type { AssistantMessage, Message as PiMessage, Tool as PiTool, ToolCall } from '@earendil-works/pi-ai';

export type PiLoopTool = PiTool & {

  needsApproval?: boolean | ((input: unknown, context: { toolCallId: string; messages: PiMessage[] }) => boolean | Promise<boolean>);
};

export type PiLoopToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type PiLoopStep = {
  index: number;
  text: string;

  thinking: string;
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

  costUsd: number;
};

export enum PiLoopEventType {
  TextDelta = 'text_delta',
  ThinkingDelta = 'thinking_delta',
  StepEnd = 'step_end',
  ToolStart = 'tool_start',
  ToolEnd = 'tool_end',
}

export type PiLoopEvent =
  | { type: PiLoopEventType.TextDelta; delta: string; step: number }
  | { type: PiLoopEventType.ThinkingDelta; delta: string; step: number }
  | { type: PiLoopEventType.StepEnd; step: PiLoopStep }
  | { type: PiLoopEventType.ToolStart; call: PiLoopToolCall }
  | {
      type: PiLoopEventType.ToolEnd;
      call: PiLoopToolCall;

      output: unknown;
    };

export type PiLoopOutcome = {
  status: 'completed' | 'budget-exhausted' | 'awaiting-approval';
  finalText: string;
  steps: PiLoopStep[];
  usage: PiUsageBuckets;

  pendingToolCalls: PiLoopToolCall[];
};

export type PiLoopDelta = {
  type: 'text_delta' | 'thinking_delta';
  delta: string;
};

export type PiLoopModelCall = (context: {
  systemPrompt: string;
  messages: PiMessage[];
  tools?: PiTool[];

  steps: ReadonlyArray<PiLoopStep>;
}) =>
  | {
      events: AsyncIterable<PiLoopDelta>;
      final: Promise<AssistantMessage>;
    }
  | Promise<{
      events: AsyncIterable<PiLoopDelta>;
      final: Promise<AssistantMessage>;
    }>;

export type PiLoopToolExecutor = (call: PiLoopToolCall) => Promise<unknown>;

export type PiLoopApprovalRequester = (call: PiLoopToolCall) => Promise<void>;

const EMPTY_USAGE: PiUsageBuckets = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
  costUsd: 0,
};

const addUsage = (a: PiUsageBuckets, b: PiUsageBuckets): PiUsageBuckets => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  reasoning: a.reasoning + b.reasoning,
  totalTokens: a.totalTokens + b.totalTokens,
  costUsd: a.costUsd + b.costUsd,
});

const usageOf = (message: AssistantMessage): PiUsageBuckets => ({
  input: message.usage?.input ?? 0,
  output: message.usage?.output ?? 0,
  cacheRead: message.usage?.cacheRead ?? 0,
  cacheWrite: message.usage?.cacheWrite ?? 0,
  reasoning: message.usage?.reasoning ?? 0,
  totalTokens: message.usage?.totalTokens ?? 0,
  costUsd: message.usage?.cost?.total ?? 0,
});

export const runPiAgentLoop = async function* (
  params: {
    systemPrompt: string;
    messages: PiMessage[];
    tools?: PiLoopTool[];
    maxSteps: number;

    terminalToolNames?: ReadonlySet<string>;
    callModel: PiLoopModelCall;
    executeTool: PiLoopToolExecutor;
    requestApproval?: PiLoopApprovalRequester;
    signal?: AbortSignal;

    onModelCall?: (settled: {
      step: number;
      text: string;
      toolCallCount: number;
      usage: PiUsageBuckets;
    }) => void;
  }
): AsyncGenerator<PiLoopEvent, PiLoopOutcome> {
  const { callModel, executeTool, requestApproval, signal, terminalToolNames, onModelCall } = params;
  const maxSteps = Number.isFinite(params.maxSteps) ? Math.max(1, Math.trunc(params.maxSteps)) : 1;
  const messages: PiMessage[] = params.messages;
  const steps: PiLoopStep[] = [];
  let usage = { ...EMPTY_USAGE };
  let lastText = '';

  for (let index = 0; index < maxSteps; index++) {
    signal?.throwIfAborted();

    const call = await callModel({
      systemPrompt: params.systemPrompt,
      messages,
      tools: params.tools,
      steps,
    });
    for await (const delta of call.events) {
      if (delta.type === 'text_delta') {
        yield { type: PiLoopEventType.TextDelta, delta: delta.delta, step: index };
        continue;
      }
      yield { type: PiLoopEventType.ThinkingDelta, delta: delta.delta, step: index };
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
    const step: PiLoopStep = { index, text, thinking, toolCalls, usage: stepUsage };
    steps.push(step);

    onModelCall?.({
      step: index,
      text,
      toolCallCount: toolCalls.length,
      usage: stepUsage,
    });
    yield { type: PiLoopEventType.StepEnd, step };
    lastText = text;

    if (toolCalls.length === 0) {
      return { status: 'completed', finalText: text, steps, usage, pendingToolCalls: [] };
    }

    const needingApproval: PiLoopToolCall[] = [];
    for (const call of toolCalls) {
      const tool = params.tools?.find(candidate => candidate.name === call.name);
      if (!tool?.needsApproval) continue;
      const needed =
        typeof tool.needsApproval === 'function'
          ? await tool.needsApproval(call.arguments, { toolCallId: call.id, messages })
          : tool.needsApproval === true;
      if (needed) needingApproval.push(call);
    }
    messages.push(final);
    if (needingApproval.length > 0) {
      if (!requestApproval) {
        throw new Error('Tool requires approval but the loop has no approval surface.');
      }
      for (const call of toolCalls) {
        if (needingApproval.includes(call)) continue;
        signal?.throwIfAborted();
        yield { type: PiLoopEventType.ToolStart, call };
        const output = await executeTool({ ...call, arguments: structuredClone(call.arguments) });
        yield { type: PiLoopEventType.ToolEnd, call, output };
        messages.push({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: toolResultText(output) }],
          isError: toolResultIsError(output),
          timestamp: Date.now(),
        });
      }
      for (const call of needingApproval) await requestApproval(call);
      return {
        status: 'awaiting-approval',
        finalText: lastText,
        steps,
        usage,
        pendingToolCalls: needingApproval,
      };
    }

    for (const call of toolCalls) {
      signal?.throwIfAborted();
      yield { type: PiLoopEventType.ToolStart, call };

      const output = await executeTool({ ...call, arguments: structuredClone(call.arguments) });
      yield { type: PiLoopEventType.ToolEnd, call, output };
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
      return { status: 'completed', finalText: lastText, steps, usage, pendingToolCalls: [] };
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

  return { status: 'budget-exhausted', finalText: lastText, steps, usage, pendingToolCalls: [] };
};

export const toolResultText = (output: unknown): string => {
  if (output === null || typeof output !== 'object' || !('type' in output)) {
    return JSON.stringify(output ?? null);
  }
  const o = output as { type: string; value?: unknown; reason?: unknown };
  switch (o.type) {
    case 'text':
    case 'error-text':
    case 'json':
    case 'error-json':
      return typeof o.value === 'string' ? o.value : JSON.stringify(o.value ?? null);
    case 'execution-denied':
      return typeof o.reason === 'string' ? o.reason : 'Tool call execution denied.';
    default:
      return JSON.stringify(o.value ?? null);
  }
};

export const toolResultIsError = (output: unknown): boolean => {
  if (output === null || typeof output !== 'object' || !('type' in output)) return false;
  const t = (output as { type: string }).type;
  return t === 'error-text' || t === 'error-json' || t === 'execution-denied';
};
