import { isDeepStrictEqual } from 'node:util';
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

export type ReplayPolicy = 'safe' | 'unsafe';

const TOOL_EXECUTION_INTERRUPTED = 'tool-execution-interrupted';

const toolInterruptedMessage = (toolName: string): string =>
  `Tool ${toolName} was interrupted and may have partially run; its outcome is unknown, so it was not retried. Verify the current state before calling it again.`;

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

  replay?: ReplayPolicy;

  executor?: { pid?: number };
};

export type ToolExecutionInterruption = {
  code: typeof TOOL_EXECUTION_INTERRUPTED;
  message: string;

  storedReplay: ReplayPolicy;
  declaredReplay: ReplayPolicy;
};

export type ToolExecutionOutcome =
  | { kind: 'pending' | 'unknown' | 'busy' }
  | { kind: 'completed'; result: ToolResult; reused: boolean; interrupted?: ToolExecutionInterruption };

/**
 * Bindings for live approvals. The approval owner registers one per call before
 * the human is asked and drops it once the call is consumed; there is no
 * durable fallback, because a pause is not resumable across a restart.
 */
const approvalBindings = new Map<string, Omit<Binding, 'threadId' | 'approvalId'>>();

export const registerApprovalBinding = (
  binding: Binding
): (() => void) => {
  const { threadId: _threadId, approvalId, ...rest } = binding;
  approvalBindings.set(approvalId, rest);
  return () => {
    if (approvalBindings.get(approvalId) === rest) approvalBindings.delete(approvalId);
  };
};

const liveAction = (address: ToolExecutionAddress) => {
  const binding = approvalBindings.get(address.approvalId);
  if (!binding) return undefined;
  return {
    binding: { ...address, ...binding },
    decision: null as null,
    reason: undefined as string | undefined,
    consumed: false,
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
  const live = recorded ? undefined : liveAction(address);
  const binding = recorded?.binding ?? live?.binding;
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
  let approval = recorded?.decision ?? live?.decision ?? null;
  if (decision) approval = decision.approved ? 'approved' : 'rejected';
  return {
    binding,
    revision,
    facts,
    decision: approval,
    reason: decision?.reason ?? live?.reason,
    legacyConsumed: live?.consumed ?? false,
  };
};
type Action = ReturnType<typeof loadAction>;

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const storedReplayPolicy = (facts: Action['facts']): ReplayPolicy => {
  for (let i = facts.length - 1; i >= 0; i -= 1) {
    const fact = facts[i];
    if (!fact) continue;
    const replay = (fact.payload as ExecutionFact).replay;
    if (replay === 'safe' || replay === 'unsafe') return replay;
  }
  return 'unsafe';
};

const declaredReplayPolicy = (toolName: string): ReplayPolicy =>
  defaultToolRegistry.get(toolName)?.replay === 'safe' ? 'safe' : 'unsafe';

const appendFact = (
  action: Action,
  type: string,
  extra?: Pick<ExecutionFact, 'result' | 'source' | 'replay'> & { executor?: ExecutionFact['executor'] }
) =>
  {
    const currentFacts = getSessionEvents(action.binding.threadId, EXECUTION_EVENTS, {
      path: '$.binding.approvalId',
      value: action.binding.approvalId,
    });
    if (currentFacts.length !== action.facts.length) return false;

    return (
      appendSessionEvents(
        action.binding.threadId,
        getSessionEventRevision(action.binding.threadId),
        [
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
        ]
      ) !== null
    );
  };

export const prepareToolExecution = (address: ToolExecutionAddress): void => {
  const action = loadAction(address);
  if (action.facts.length) return;
  if (action.legacyConsumed) throw new Error('Cannot admit a previously consumed legacy action.');

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

type ExecutionPort = {
  signal: AbortSignal;
  execute: (toolName: string, args: unknown) => Promise<unknown>;
};

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

    const interrupted = interruptedOutcome(action.facts);
    return { kind: 'completed', result, reused: true, ...(interrupted ? { interrupted } : {}) };
  }
  if (!action.decision) return { kind: 'pending' };
  if (action.decision !== 'approved') {

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

  const started = action.facts.filter(event => event.type === TOOL_EXECUTION_STARTED).at(-1);
  if (started) {
    const claim = (started.payload as ExecutionFact).executor;

    if (typeof claim?.pid !== 'number' || (claim.pid !== process.pid && isProcessAlive(claim.pid)))
      return { kind: 'unknown' };
    const storedReplay = storedReplayPolicy(action.facts);
    const declaredReplay = declaredReplayPolicy(action.binding.toolName);

    if (storedReplay === 'safe' && declaredReplay === 'safe') {
      port.signal.throwIfAborted();

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

const active = new Map<string, Promise<ToolExecutionOutcome>>();

export type InlineToolExecution = {
  threadId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  output: unknown;
};

const KNOWN_OUTPUT_TYPES = new Set(['text', 'json', 'error-text', 'content', 'execution-denied']);

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
