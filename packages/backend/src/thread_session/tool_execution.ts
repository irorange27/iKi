import { isDeepStrictEqual } from 'node:util';
import { getToolCallApproval, getToolCallApprovalSession } from '../db/tool_call_approval';
import { findMessageEvent } from '../db/session_events';
import {
  appendSessionEvents,
  appendSessionFacts,
  getSessionEventRevision,
  getSessionEvents,
} from '../db/session_events';
import { parseStoredUiMessageRow } from '../message/ui_message_codec';
import { toModelInputMessages } from '../message/ui_messages';
import type { JsonValue } from '../types/provider';
import { getErrorMessage } from '../utils/errors';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '../utils/runtime_context';
import { parseStoredWorkspaceSelection } from '../workspaces/thread_workspace';
import { defaultToolRegistry } from '../tools/base';
import {
  APPROVAL_DECIDED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  SessionLogCommitError,
  TOOL_EXECUTED,
  recordSessionEvents,
} from './session_log';

export const TOOL_EXECUTION_PREPARED = 'tool_execution_prepared';
export const TOOL_EXECUTION_STARTED = 'tool_execution_started';
export const TOOL_EXECUTION_FINISHED = 'tool_execution_finished';
const EXECUTION_EVENTS = [TOOL_EXECUTION_PREPARED, TOOL_EXECUTION_STARTED, TOOL_EXECUTION_FINISHED];

/** A tool's replay policy. Absent means `unsafe` — never infer permission. */
export type ReplayPolicy = 'safe' | 'unsafe';

/**
 * The structured result code for a call that was claimed, never finished, and
 * may not be replayed. Distinct from `execution-denied` (a human said no, so
 * nothing ran) and from a handler error (the tool ran and reported failure):
 * here the world state is genuinely unknown.
 */
export const TOOL_EXECUTION_INTERRUPTED = 'tool-execution-interrupted';

/** Pi's wording for the same state: the effect may have partially run. */
export const toolInterruptedMessage = (toolName: string): string =>
  `Tool ${toolName} was interrupted and may have partially run; its outcome is unknown, so it was not retried. Verify the current state before calling it again.`;

/**
 * The tool-result shape this module hands back. Structurally identical to the
 * Pi harness's own outcome result (both are the `type: 'tool-result'` part), so
 * the two declarations stay assignable — they were compared by the resume
 * wiring and diverged when they were declared independently.
 */
type ToolResult = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: unknown;
};
export type ToolExecutionAddress = { threadId: string; approvalId: string };
type Binding = ToolExecutionAddress & {
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  workspace: string | null;
};
type ExecutionFact = {
  binding: Binding;
  decision: 'approved' | 'rejected' | null;
  result?: ToolResult;
  source?: 'legacy' | 'execution' | 'recovery';
  /** The replay policy committed WITH the intent, before any effect ran. */
  replay?: ReplayPolicy;
  /** The process that claimed the effect (STARTED), for liveness checks. */
  executor?: { pid?: number };
};

/** Why a claimed-but-unfinished call was answered instead of replayed. */
export type ToolExecutionInterruption = {
  code: typeof TOOL_EXECUTION_INTERRUPTED;
  message: string;
  /** The double sign, reported so a human can see which side withheld it. */
  storedReplay: ReplayPolicy;
  declaredReplay: ReplayPolicy;
};

export type ToolExecutionOutcome =
  | { kind: 'pending' | 'unknown' | 'busy' }
  | { kind: 'completed'; result: ToolResult; reused: boolean; interrupted?: ToolExecutionInterruption };

const legacyAction = (address: ToolExecutionAddress) => {
  const approval = getToolCallApproval(address.approvalId);
  const session = approval && getToolCallApprovalSession(approval.session_id);
  if (!approval?.tool_call_id || !approval.tool_name || session?.thread_id !== address.threadId) {
    throw new Error('Tool approval is missing its execution binding.');
  }
  return {
    binding: {
      ...address,
      messageId: session.assistant_message_id,
      toolCallId: approval.tool_call_id,
      toolName: approval.tool_name,
      args: JSON.parse(approval.tool_args ?? '{}') as unknown,
      workspace: session.workspace_selection ?? null,
    },
    decision: approval.decision ?? null,
    reason: approval.decision_reason ?? undefined,
    consumed: approval.state === 'consumed',
  };
};

const loadAction = (address: ToolExecutionAddress) => {
  const revision = getSessionEventRevision(address.threadId);
  const facts = getSessionEvents(address.threadId, EXECUTION_EVENTS, {
    path: '$.binding.approvalId',
    value: address.approvalId,
  });
  if (facts.some(event => event.version !== SESSION_EVENT_VERSION)) {
    throw new Error('Unsupported tool execution event version.');
  }
  const recorded = facts[0]?.payload as ExecutionFact | undefined;
  const legacy = recorded ? undefined : legacyAction(address);
  const binding = recorded?.binding ?? legacy!.binding;
  if (
    !binding ||
    binding.threadId !== address.threadId ||
    binding.approvalId !== address.approvalId ||
    facts.some(event => !isDeepStrictEqual((event.payload as ExecutionFact).binding, binding))
  ) {
    throw new Error('Tool approval is missing a consistent execution binding.');
  }
  const decisions = getSessionEvents(address.threadId, [APPROVAL_DECIDED], {
    path: '$.approvalId',
    value: address.approvalId,
  });
  const latest = decisions.at(-1);
  if (latest && latest.version !== SESSION_EVENT_VERSION)
    throw new Error('Unsupported approval event version.');
  const decision = latest?.payload as { approved: boolean; reason?: string } | undefined;
  let approval = recorded?.decision ?? legacy?.decision ?? null;
  if (decision) approval = decision.approved ? 'approved' : 'rejected';
  return {
    binding,
    revision,
    facts,
    decision: approval,
    reason: decision?.reason ?? legacy?.reason,
    legacyConsumed: legacy?.consumed ?? false,
  };
};
type Action = ReturnType<typeof loadAction>;

/**
 * Whether a process is still running. `EPERM` means it exists but belongs to
 * another user — alive for our purposes; only `ESRCH` proves it is gone.
 */
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * The replay policy stored with the call's intent. The latest declaration wins;
 * anything absent or unreadable is `unsafe` — the fail-closed default.
 */
const storedReplayPolicy = (facts: Action['facts']): ReplayPolicy => {
  for (let i = facts.length - 1; i >= 0; i -= 1) {
    const fact = facts[i];
    if (!fact) continue;
    const replay = (fact.payload as ExecutionFact).replay;
    if (replay === 'safe' || replay === 'unsafe') return replay;
  }
  return 'unsafe';
};

/**
 * The policy the tool declares NOW. A tool missing from the registry (an MCP
 * server that is not connected this boot, a delegated child's unregistered
 * tool) declares nothing, and nothing is `unsafe`.
 */
const declaredReplayPolicy = (toolName: string): ReplayPolicy =>
  defaultToolRegistry.get(toolName)?.replay === 'safe' ? 'safe' : 'unsafe';

const appendFact = (
  action: Action,
  type: string,
  extra?: Pick<ExecutionFact, 'result' | 'source' | 'replay'> & { executor?: ExecutionFact['executor'] }
) =>
  appendSessionEvents(action.binding.threadId, action.revision, [
    {
      type,
      version: SESSION_EVENT_VERSION,
      payload: {
        binding: action.binding,
        decision: action.decision,
        ...(extra?.result ? { result: extra.result } : {}),
        ...(extra?.source ? { source: extra.source } : {}),
        ...(extra?.replay ? { replay: extra.replay } : {}),
        ...(extra?.executor ? { executor: extra.executor } : {}),
      },
    },
  ]) !== null;

/** Admit this action to this executor before the approval owner consumes it.
 * A legacy consumed row without this fact is ambiguous, never permission to start. */
export const prepareToolExecution = (address: ToolExecutionAddress): void => {
  const action = loadAction(address);
  if (action.facts.length) return;
  if (action.legacyConsumed) throw new Error('Cannot admit a previously consumed legacy action.');
  // Commit the replay policy WITH the intent, before the effect: recovery reads
  // this stored sign, not the tool's declaration at recovery time. A tool that
  // later narrows its declaration must not retroactively authorize a rerun.
  if (
    !appendFact(action, TOOL_EXECUTION_PREPARED, {
      replay: declaredReplayPolicy(action.binding.toolName),
    })
  )
    throw new SessionLogCommitError('');
};

const recordedResult = async (action: Action): Promise<ToolResult | undefined> => {
  const finished = action.facts.findLast(event => event.type === TOOL_EXECUTION_FINISHED);
  if (finished) {
    const result = (finished.payload as ExecutionFact).result;
    if (
      !result ||
      result.type !== 'tool-result' ||
      result.toolCallId !== action.binding.toolCallId ||
      result.toolName !== action.binding.toolName
    )
      throw new Error('Invalid recorded tool result.');
    return result;
  }
  // Reuse the history owner's converter, scoped to the bound assistant message.
  // Only terminal results qualify; pending/interrupted input is never repaired
  // into evidence that an effect completed.
  const snapshots = getSessionEvents(action.binding.threadId, [MODEL_OUTPUT_COMMITTED], {
    path: '$.messageId',
    value: action.binding.messageId,
  });
  const latest = snapshots.at(-1)?.payload as { message?: unknown } | undefined;
  const legacyEvent = latest
    ? undefined
    : findMessageEvent(action.binding.messageId, action.binding.threadId);
  const legacy = legacyEvent
    ? {
        id: action.binding.messageId,
        thread_id: legacyEvent.threadId,
        message: JSON.stringify((legacyEvent.payload as { message?: unknown }).message ?? {}),
      }
    : undefined;
  const message =
    latest?.message ??
    (legacy?.thread_id === action.binding.threadId ? parseStoredUiMessageRow(legacy) : undefined);
  if (!message) return undefined;
  const history = await toModelInputMessages([message], { repairInterruptedTools: false });
  return history
    .filter(message => message.role === 'tool')
    .flatMap(message => message.content)
    .find(
      (part): part is ToolResult =>
        part.type === 'tool-result' &&
        part.toolCallId === action.binding.toolCallId &&
        part.toolName === action.binding.toolName
    );
};

/** The execution record lives in Session log. The caller owns live turn
 * admission/cancellation; a persisted approval alone does not revive a turn. */
type ExecutionPort = {
  signal: AbortSignal;
  execute: (toolName: string, args: unknown) => Promise<unknown>;
};

/**
 * The interruption a recovery journaled for this call, if the recorded outcome
 * is one. Read from the FINISHED fact rather than remembered in memory, so a
 * later process reports the same state.
 */
const interruptedOutcome = (facts: Action['facts']): ToolExecutionInterruption | undefined => {
  const finished = facts.findLast(event => event.type === TOOL_EXECUTION_FINISHED);
  const payload = finished?.payload as ExecutionFact | undefined;
  if (payload?.source !== 'recovery') return undefined;
  const output = payload.result?.output as { type?: unknown; value?: unknown } | undefined;
  if (output?.type !== 'error-json') return undefined;
  const value = output.value as
    | { code?: unknown; message?: unknown; storedReplay?: unknown; declaredReplay?: unknown }
    | undefined;
  if (value?.code !== TOOL_EXECUTION_INTERRUPTED || typeof value.message !== 'string')
    return undefined;
  return {
    code: TOOL_EXECUTION_INTERRUPTED,
    message: value.message,
    storedReplay: value.storedReplay === 'safe' ? 'safe' : 'unsafe',
    declaredReplay: value.declaredReplay === 'safe' ? 'safe' : 'unsafe',
  };
};

const execute = async (
  address: ToolExecutionAddress,
  port: ExecutionPort
): Promise<ToolExecutionOutcome> => {
  const action = loadAction(address);
  const result = await recordedResult(action);
  if (result) {
    if (
      !action.facts.some(event => event.type === TOOL_EXECUTION_FINISHED) &&
      !appendFact(action, TOOL_EXECUTION_FINISHED, { result, source: 'legacy' })
    )
      return { kind: 'busy' };
    // A recovery that answered "interrupted" journaled that answer as the
    // call's outcome. Reuse must re-report the interruption, not dress it up as
    // a plain reuse: the world state is still unknown, and a caller that only
    // saw `reused: true` would treat the call as successfully observed.
    const interrupted = interruptedOutcome(action.facts);
    return { kind: 'completed', result, reused: true, ...(interrupted ? { interrupted } : {}) };
  }
  if (!action.decision) return { kind: 'pending' };
  if (action.decision !== 'approved') {
    // The denial is an outcome like any other: journaled, so an effect-aware
    // recovery (#143) pairs the refused call with its execution-denied
    // result and the model does not re-ask a user who already said no. A
    // failed write leaves the decision unexecuted — the retry re-derives the
    // same denial (no effect to duplicate).
    const deniedResult: ToolResult = {
      type: 'tool-result',
      toolCallId: action.binding.toolCallId,
      toolName: action.binding.toolName,
      output: { type: 'execution-denied', reason: action.reason ?? 'Tool execution denied.' },
    };
    if (!appendFact(action, TOOL_EXECUTION_FINISHED, { result: deniedResult, source: 'execution' }))
      return { kind: 'busy' };
    return { kind: 'completed', reused: false, result: deniedResult };
  }
  if (
    !action.facts.some(event => event.type === TOOL_EXECUTION_PREPARED) ||
    action.legacyConsumed
  )
    return { kind: 'unknown' };
  // A STARTED fact means the effect was claimed. Recovery decides between
  // replaying it and reporting it — the effect sandwich's second half.
  const started = action.facts.filter(event => event.type === TOOL_EXECUTION_STARTED).at(-1);
  if (started) {
    const claim = (started.payload as ExecutionFact).executor;
    // Only a claim we can ATTRIBUTE and PROVE dead is ours to adjudicate. A
    // claim with no executor pid (written before this contract existed, or by a
    // writer that did not identify itself) cannot be shown to be gone, so the
    // effect may still be in flight elsewhere: that stays `unknown`, the
    // pre-contract answer, rather than being guessed at. A recycled pid reads as
    // alive and lands here too — fail-closed.
    if (typeof claim?.pid !== 'number' || (claim.pid !== process.pid && isProcessAlive(claim.pid)))
      return { kind: 'unknown' };
    const storedReplay = storedReplayPolicy(action.facts);
    const declaredReplay = declaredReplayPolicy(action.binding.toolName);
    // The double sign: BOTH must say safe. Rerunning on the stored sign alone
    // would let a tool that narrowed its declaration since the crash replay an
    // effect it no longer considers replayable; on the declared sign alone it
    // would let a tool that widened it launder an unsafe interrupted call.
    if (storedReplay === 'safe' && declaredReplay === 'safe') {
      port.signal.throwIfAborted();
      // Re-claiming is a new attempt of a read; the prior attempt's STARTED
      // stays as history. A fresh STARTED keeps the claim alive for a second
      // crash mid-replay.
      if (!appendFact(action, TOOL_EXECUTION_STARTED, { executor: { pid: process.pid } }))
        return { kind: 'busy' };
      port.signal.throwIfAborted();
      return await runEffect(action, port);
    }
    return interrupt(action, storedReplay, declaredReplay);
  }
  port.signal.throwIfAborted();
  if (!appendFact(action, TOOL_EXECUTION_STARTED, { executor: { pid: process.pid } }))
    return { kind: 'busy' };
  port.signal.throwIfAborted();
  return await runEffect(action, port);
};

/** Perform the effect and journal the observation. */
const runEffect = async (action: Action, port: ExecutionPort): Promise<ToolExecutionOutcome> => {
  let value: unknown;
  try {
    const workspace = parseStoredWorkspaceSelection(action.binding.workspace);
    value = await runWithToolRuntimeContext(
      {
        ...getToolRuntimeContext(),
        threadId: action.binding.threadId,
        abortSignal: port.signal,
        ...(workspace !== undefined ? { workspaceSelectionBox: { selection: workspace } } : {}),
      },
      () => port.execute(action.binding.toolName, structuredClone(action.binding.args))
    );
  } catch (error) {
    const observation: ToolResult = {
      type: 'tool-result',
      toolCallId: action.binding.toolCallId,
      toolName: action.binding.toolName,
      output: { type: 'error-text', value: getErrorMessage(error) },
    };
    return finish(action, observation);
  }
  const observation: ToolResult = {
    type: 'tool-result',
    toolCallId: action.binding.toolCallId,
    toolName: action.binding.toolName,
    output:
      typeof value === 'string'
        ? { type: 'text', value }
        : { type: 'json', value: JSON.parse(JSON.stringify(value ?? null)) as JsonValue },
  };
  return finish(action, observation);
};

/**
 * Answer a claimed-but-unfinished call whose replay is not doubly safe. The
 * result is journaled as the call's terminal outcome (`source: 'recovery'`), so
 * the pairing is durable: a second recovery reuses it instead of asking again,
 * and the model receives a paired error result on the next turn.
 */
const interrupt = (
  action: Action,
  storedReplay: ReplayPolicy,
  declaredReplay: ReplayPolicy
): ToolExecutionOutcome => {
  const message = toolInterruptedMessage(action.binding.toolName);
  const interruption: ToolExecutionInterruption = {
    code: TOOL_EXECUTION_INTERRUPTED,
    message,
    storedReplay,
    declaredReplay,
  };
  // `error-json` keeps the structured code on the wire AND on the transcript
  // (the model reads the JSON), while marking the part as an error so no
  // consumer mistakes the unknown outcome for a successful observation.
  const observation: ToolResult = {
    type: 'tool-result',
    toolCallId: action.binding.toolCallId,
    toolName: action.binding.toolName,
    output: {
      type: 'error-json',
      value: { code: interruption.code, message, storedReplay, declaredReplay },
    },
  };
  if (!appendFact(action, TOOL_EXECUTION_FINISHED, { result: observation, source: 'recovery' }))
    return { kind: 'busy' };
  return { kind: 'completed', result: observation, reused: false, interrupted: interruption };
};

const finish = (action: Action, observation: ToolResult): ToolExecutionOutcome => {
  // Completion commits the actual observation, not an 'ok' marker. If writing
  // fails, the start remains and future commands refuse blind replay.
  appendSessionFacts(action.binding.threadId, [
    {
      type: TOOL_EXECUTION_FINISHED,
      version: SESSION_EVENT_VERSION,
      payload: {
        binding: action.binding,
        decision: action.decision,
        result: observation,
        source: 'execution',
      },
    },
  ]);
  return { kind: 'completed', result: observation, reused: false };
};

// Live promises are process resources, never replayed from the log. Joining
// one preserves its real result instead of inventing an "unknown" observation.
const active = new Map<string, Promise<ToolExecutionOutcome>>();

export type InlineToolExecution = {
  threadId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  output: unknown;
};

/** The ToolResultOutput union members the wire schema accepts. */
const KNOWN_OUTPUT_TYPES = new Set(['text', 'json', 'error-text', 'content', 'execution-denied']);

/** Harness executors hand over heterogeneous outputs — the AI SDK toolset
 * returns the handler's RAW value (a string for text tools) while the Pi
 * executor wraps. Normalize to the wire's ToolResultOutput union; an
 * already-shaped output passes through, anything else becomes JSON. */
const normalizeInlineOutput = (output: unknown): unknown => {
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

/**
 * Journal one INLINE tool execution (issue #145): an effect that happened
 * without entering the five-state owner's admission (policy-permitted calls
 * the model loop executes directly). Single fact — the turn owns the
 * execution, there is no cross-process admission to record. Fail-closed on
 * purpose: a lost effect record means the effect-aware retry would re-issue
 * the call, so a write failure fails the turn (ADR 008 F1). Callers journal
 * successful executions only — denials and handler errors produced no world
 * effect. Owner-executed calls (the Pi resume block) journal through the
 * owner instead and MUST NOT come through here.
 */
export const recordInlineToolExecution = (execution: InlineToolExecution): void => {
  recordSessionEvents(execution.threadId, [
    {
      type: TOOL_EXECUTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        runId: execution.runId,
        toolCallId: execution.toolCallId,
        toolName: execution.toolName,
        args: execution.args,
        result: {
          type: 'tool-result',
          toolCallId: execution.toolCallId,
          toolName: execution.toolName,
          output: normalizeInlineOutput(execution.output),
        },
      },
    },
  ]);
};

export const executeApprovedTool = (
  address: ToolExecutionAddress,
  port: ExecutionPort
): Promise<ToolExecutionOutcome> => {
  const key = JSON.stringify([address.threadId, address.approvalId]);
  const running = active.get(key);
  if (running)
    return running.then(outcome =>
      outcome.kind === 'completed'
        ? { ...outcome, result: structuredClone(outcome.result), reused: true }
        : outcome
    );
  const execution = execute(address, port).finally(() => active.delete(key));
  active.set(key, execution);
  return execution;
};
