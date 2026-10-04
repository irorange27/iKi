import type { AssistantMessage, Message as PiMessage, Tool as PiTool, ToolCall } from '@earendil-works/pi-ai';

/**
 * The iKi-owned agent loop over the Pi supply layer (switch item 2a/2b,
 * generator form since 3a — issue #114). Semantics are pinned against the
 * existing harness:
 *
 * - one model call = one step; the step budget (maxSteps) bounds calls;
 * - tool calls in ANY step — including the last — execute (the harness
 *   semantics: stopWhen stops AFTER the step's tools ran);
 * - when the budget exhausts with pending tool calls, the turn ends
 *   budget-exhausted: effects were executed and recorded, but no further
 *   model call happens and the pending calls are reported (D7–D8);
 * - cancellation is checked before each model call and before each effect;
 * - tools flagged needsApproval pause the turn BEFORE any effect: the
 *   injected approval surface registers them with the approval owner and
 *   the outcome is awaiting-approval — decisions and resumption belong to
 *   a new loop run over the recovered history (the five-state contract
 *   lives in the approval owner, not here);
 * - usage accumulates in raw Pi buckets — the mapping to iKi's
 *   total-prompt convention is linear, so the caller may map the sum
 *   (projectUsageToIki) or map per step and add;
 * - terminal tools (handoff) execute in their step and then end the turn —
 *   `stopWhen: hasToolCall('handoff')` parity (switch item 3a review).
 *
 * The loop is an ASYNC GENERATOR (switch item 3a, issue #114 — the
 * deliberate contract extension the wiring needed): it yields live events
 * and returns the outcome. Generator suspension is what lets "tool
 * executing right now" stream through the harness to the TurnDriver while
 * the effect is still running — a callback loop cannot regain control
 * mid-await. Event order is the runner's order: this call's deltas, then
 * StepEnd; per tool: ToolStart BEFORE the effect, ToolEnd AFTER it.
 *
 * The model call is injected: wiring hands this loop the Pi adapter's
 * callPiChat wrapped for live deltas; tests hand a scripted double. It
 * receives the loop's LIVE transcript — a retry wrapper persists its
 * recovery notes by pushing user messages before re-attempts (runner
 * parity), and those notes then ride every later step. The wrapper owns
 * retry bounds; the loop treats a non-aborted error stopReason as a
 * terminal failure and classifies aborts as AbortError for the driver.
 * This module owns ORCHESTRATION only — protocol, history projection and
 * tool ownership stay with their modules.
 * maxSteps values that are not finite fall back to 1.
 */

export type PiLoopTool = PiTool & {
  /** Whether a call to this tool pauses the loop before its effect: the
   * injected approval surface registers the call with the approval owner and
   * the turn ends awaiting-approval (the resume is a new loop run). A
   * FUNCTION is evaluated per call — the resolver's per-call policy decision
   * (the policy box state lives in its closure); a boolean applies to every
   * call. */
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
  /** Thinking blocks of this step's final message, joined — the ModelMessage
   * mirror maps them to reasoning parts. */
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
};

/** Event discriminators for the loop's event stream. The wiring maps these
 * onto the TurnDriver's protocol one-to-one. */
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
      /** The tool result in the repo's canonical ToolResultOutput vocabulary —
       * the shape the driver projects to the UI and history keeps. */
      output: unknown;
    };

export type PiLoopOutcome = {
  status: 'completed' | 'budget-exhausted' | 'awaiting-approval';
  finalText: string;
  steps: PiLoopStep[];
  usage: PiUsageBuckets;
  /** Budget-exhausted: tool calls from the final step — EXECUTED, results
   * recorded on the transcript, but not yet consumed by a model call.
   * Awaiting-approval: the calls that REQUIRE approval and were registered
   * with the approval surface — they have NOT run. Reporting both lets the
   * driver surface what happened without implying unexecuted side effects. */
  pendingToolCalls: PiLoopToolCall[];
};

/** One live delta from the model call's event stream. */
export type PiLoopDelta = {
  type: 'text_delta' | 'thinking_delta';
  delta: string;
};

/**
 * The injected call streams deltas LIVE (an async iterable consumed as they
 * arrive) and resolves with the final message. It receives the loop's LIVE
 * transcript array: a retry wrapper pushes its recovery notes onto it before
 * re-attempts, so notes persist across the turn (runner parity). Abort and
 * error stop reasons on the final message are the loop's failure surface —
 * the wrapper handles retries before that.
 */
export type PiLoopModelCall = (context: {
  systemPrompt: string;
  messages: PiMessage[];
  tools?: PiTool[];
}) => {
  events: AsyncIterable<PiLoopDelta>;
  final: Promise<AssistantMessage>;
};

export type PiLoopToolExecutor = (call: PiLoopToolCall) => Promise<unknown>;

/** Registers an approval-needing call with the approval owner (the real
 * implementation is the approval surface's registration primitive). The
 * turn ends awaiting-approval after registration; decisions and resumption
 * are the approval owner's, via a NEW loop run over the recovered history. */
export type PiLoopApprovalRequester = (call: PiLoopToolCall) => Promise<void>;

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

export const runPiAgentLoop = async function* (
  params: {
    systemPrompt: string;
    messages: PiMessage[];
    tools?: PiLoopTool[];
    maxSteps: number;
    /** Terminal tools stop the turn after their step executes — the AI SDK
     * path's `stopWhen: hasToolCall('handoff')` parity. The tool still
     * executes; no further model call follows. Owned by the runner
     * (TERMINAL_TOOL_NAMES), passed in by the wiring. */
    terminalToolNames?: ReadonlySet<string>;
    callModel: PiLoopModelCall;
    executeTool: PiLoopToolExecutor;
    requestApproval?: PiLoopApprovalRequester;
    signal?: AbortSignal;
  }
): AsyncGenerator<PiLoopEvent, PiLoopOutcome> {
  const { callModel, executeTool, requestApproval, signal, terminalToolNames } = params;
  const maxSteps = Number.isFinite(params.maxSteps) ? Math.max(1, Math.trunc(params.maxSteps)) : 1;
  const messages: PiMessage[] = params.messages;
  const steps: PiLoopStep[] = [];
  let usage = { ...EMPTY_USAGE };
  let lastText = '';

  for (let index = 0; index < maxSteps; index++) {
    signal?.throwIfAborted();
    const call = callModel({
      systemPrompt: params.systemPrompt,
      messages,
      tools: params.tools,
    });
    for await (const delta of call.events) {
      if (delta.type === 'text_delta') {
        yield { type: PiLoopEventType.TextDelta, delta: delta.delta, step: index };
        continue;
      }
      yield { type: PiLoopEventType.ThinkingDelta, delta: delta.delta, step: index };
    }
    const final = await call.final;

    // Pi resolves provider failures into a result message — the stopReason
    // is the failure surface; the retry wrapper (if any) had its chance.
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
    yield { type: PiLoopEventType.StepEnd, step };
    lastText = text;

    if (toolCalls.length === 0) {
      return { status: 'completed', finalText: text, steps, usage, pendingToolCalls: [] };
    }

    // Approval pause BEFORE the needing calls' effects: the needing calls
    // are decided PER CALL (the resolver's function, evaluated with the
    // current step's policy snapshot). The step's NON-needing calls EXECUTE
    // first — the AI SDK path runs them and leaves only the needing ones
    // pending; a step mixing both is the ordinary askRisky case. The
    // assistant message is pushed ONCE before any effect (providers reject a
    // tool_calls message answered piecemeal), and the free calls' results
    // ride the transcript so the resumed request stays wire-valid.
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

    // Tools in ANY step execute — including the last (harness semantics).
    // The results ride the transcript; the budget decides whether another
    // model call follows.
    for (const call of toolCalls) {
      signal?.throwIfAborted();
      yield { type: PiLoopEventType.ToolStart, call };
      // The executor gets its own copy: a mutating executor must not corrupt
      // the recorded trajectory (the transcript references the same args).
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

    // Terminal tools (handoff parity): the step's tools executed; the turn
    // ends now — no further model call, and budget does not apply (the
    // driver's handoff branch reads the executed call from the outcome).
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

  // Unreachable: the loop returns inside the last iteration.
  return { status: 'budget-exhausted', finalText: lastText, steps, usage, pendingToolCalls: [] };
};

/** The transcript text for one tool result output — the documented protocol
 * (a JSON tool result is read by the model as text). Exported for the resume
 * path, which appends owner-produced results to the same transcript shape. */
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
