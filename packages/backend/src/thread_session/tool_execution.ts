import {
  appendSessionEvents,
  appendSessionFacts,
  findMessageEvent,
  getSessionEventRevision,
  getSessionEvents,
} from '../db/session_events';
import type { ModelMessage } from '../message/model_history';
import { normalizeToolOutput } from '../message/model_history';
import { normalizeUiMessage } from '../message/ui_message_codec';
import { toModelInputMessages } from '../message/ui_messages';
import { getErrorMessage } from '../utils/errors';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '../utils/runtime_context';
import { parseStoredWorkspaceSelection } from '../workspaces/thread_workspace';
import { defaultToolRegistry } from '../tools/base';
import {
  TOOL_EXECUTION_FINISHED,
  TOOL_EXECUTION_PREPARED,
  TOOL_EXECUTION_STARTED,
} from '@iki/backend/types/session_events';
import {
  APPROVAL_DECIDED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  SessionLogCommitError,
  TOOL_EXECUTED,
  assertSupportedEventVersions,
  recordSessionEvents,
} from './session_log';

export {
  TOOL_EXECUTION_FINISHED,
  TOOL_EXECUTION_PREPARED,
  TOOL_EXECUTION_STARTED,
} from '@iki/backend/types/session_events';
const EXECUTION_EVENTS = [TOOL_EXECUTION_PREPARED, TOOL_EXECUTION_STARTED, TOOL_EXECUTION_FINISHED];

type ReplayPolicy = 'safe' | 'unsafe';

const TOOL_EXECUTION_INTERRUPTED = 'tool-execution-interrupted';

const toolInterruptedMessage = (toolName: string): string =>
  `Tool ${toolName} was interrupted and may have partially run; its outcome is unknown, so it was not retried. Verify the current state before calling it again.`;

type ToolResult = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: unknown;
};

/**
 * A tool call and its outcome, as the execution journal recorded them. The call's
 * identity lives in the binding, so the recorded fact carries only the output;
 * stamping the id and name into the result as well would put one fact in two
 * places and force every reader to check that they still agree.
 */
type ExecutionFact = {
  binding: Binding;
  decision: 'approved' | 'rejected' | null;
  output?: unknown;
  source?: 'legacy' | 'execution' | 'recovery';

  replay?: ReplayPolicy;

  executor?: { pid?: number };

  interruption?: { storedReplay: ReplayPolicy; declaredReplay: ReplayPolicy };
};

type ToolExecutionAddress = { threadId: string; approvalId: string };
type Binding = ToolExecutionAddress & {
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  workspace: string | null;
};

const wireResult = (binding: Binding, output: unknown): ToolResult => ({
  type: 'tool-result',
  toolCallId: binding.toolCallId,
  toolName: binding.toolName,
  output,
});

/**
 * The exchange a finished fact represents, for a reader that has to rebuild the
 * model's view of the call. This module writes these facts, so it is also the only
 * place that knows how to read them back.
 */
export type JournaledToolExchange = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  output: unknown;
};

/**
 * Reading an execution fact back. Three outcomes, because the recovery caller has
 * to treat them differently: a call that began, a call whose whole exchange can be
 * shown to the model, and a row this build cannot represent.
 */
export type ToolExecutionFactReader =
  | { kind: 'started'; approvalId: string }
  | { kind: 'exchange'; approvalId: string; exchange: JournaledToolExchange }
  | { kind: 'unreadable'; approvalId: string | null };

export const readToolExecutionFact = (event: {
  type: string;
  payload: unknown;
}): ToolExecutionFactReader | null => {
  if (event.type !== TOOL_EXECUTION_STARTED && event.type !== TOOL_EXECUTION_FINISHED)
    return null;
  const fact = event.payload as ExecutionFact;
  const { binding } = fact;
  if (!binding || typeof binding.approvalId !== 'string') {
    return { kind: 'unreadable', approvalId: null };
  }
  if (event.type === TOOL_EXECUTION_STARTED) return { kind: 'started', approvalId: binding.approvalId };
  // A finished row is representable only if it can say what was called, with what,
  // and what came back. This is the shape the recovery needs, not a cross-check of
  // two copies of one fact: the identity lives in the binding and nowhere else.
  if (
    typeof binding.toolCallId !== 'string' ||
    !binding.toolCallId ||
    typeof binding.toolName !== 'string' ||
    !binding.toolName ||
    binding.args === undefined ||
    fact.output === undefined
  ) {
    return { kind: 'unreadable', approvalId: binding.approvalId };
  }
  return {
    kind: 'exchange',
    approvalId: binding.approvalId,
    exchange: {
      toolCallId: binding.toolCallId,
      toolName: binding.toolName,
      args: binding.args,
      output: fact.output,
    },
  };
};

/** The tool-call / tool-result pair a journaled execution contributes to history. */
export const exchangeToModelMessages = (
  exchange: JournaledToolExchange
): [ModelMessage, ModelMessage] => [
  {
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: exchange.toolCallId, toolName: exchange.toolName, input: exchange.args },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: exchange.toolCallId,
        toolName: exchange.toolName,
        output: exchange.output as Extract<
          Extract<ModelMessage, { role: 'tool' }>['content'][number],
          { type: 'tool-result' }
        >['output'],
      },
    ],
  },
];

import type {
  ToolExecutionInterruption,
  ToolExecutionOutcome,
} from '../agent/harness/harness_types';

export type { ToolExecutionOutcome, ToolExecutionInterruption } from '../agent/harness/harness_types';

/**
 * Bindings for live approvals. The approval owner registers one per call before
 * the human is asked and drops it once the call is consumed; there is no
 * durable fallback, because a pause is not resumable across a restart.
 */
const approvalBindings = new Map<string, Binding>();

export const registerApprovalBinding = (binding: Binding): (() => void) => {
  approvalBindings.set(binding.approvalId, binding);
  return () => {
    if (approvalBindings.get(binding.approvalId) === binding)
      approvalBindings.delete(binding.approvalId);
  };
};

const liveAction = (address: ToolExecutionAddress) => {
  const binding = approvalBindings.get(address.approvalId);
  if (!binding || binding.threadId !== address.threadId) return undefined;
  return {
    binding,
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
  assertSupportedEventVersions(facts, 'tool execution');
  // The first fact of the chain is the write that opened it, so its binding is the
  // record. Re-comparing the copies carried by later facts would only turn stored
  // corruption into a second failure on top of the first one.
  const recorded = facts[0]?.payload as ExecutionFact | undefined;
  const live = recorded ? undefined : liveAction(address);
  const binding = recorded?.binding ?? live?.binding;
  if (!binding) {
    throw new Error('Tool approval is missing an execution binding.');
  }
  const decisions = getSessionEvents(address.threadId, [APPROVAL_DECIDED], {
    path: '$.approvalId',
    value: address.approvalId,
  });
  assertSupportedEventVersions(decisions, 'approval');
  const latest = decisions.at(-1);
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
  extra?: Pick<ExecutionFact, 'output' | 'source' | 'replay' | 'interruption'> & {
    executor?: ExecutionFact['executor'];
  }
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
              ...(extra?.output !== undefined ? { output: extra.output } : {}),
              ...(extra?.source ? { source: extra.source } : {}),
              ...(extra?.replay ? { replay: extra.replay } : {}),
              ...(extra?.interruption ? { interruption: extra.interruption } : {}),
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
    const fact = finished.payload as ExecutionFact;
    if (!('output' in fact)) throw new Error('A finished execution fact has no output.');
    return wireResult(action.binding, fact.output);
  }

  const snapshots = getSessionEvents(action.binding.threadId, [MODEL_OUTPUT_COMMITTED], {
    path: '$.messageId',
    value: action.binding.messageId,
  });
  const latest = snapshots.at(-1)?.payload as { message?: unknown } | undefined;
  const message =
    latest?.message ??
    (() => {
      // Only pre-journal threads need this: their committed message was stored
      // before the execution facts existed.
      const found = findMessageEvent(action.binding.messageId, action.binding.threadId);
      if (!found || found.threadId !== action.binding.threadId) return undefined;
      return normalizeUiMessage((found.payload as { message?: unknown }).message, {
        fallbackId: action.binding.messageId,
        fallbackRole: 'assistant',
      });
    })();
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
  const fact = finished?.payload as ExecutionFact | undefined;
  const interruption = fact?.interruption;
  if (!interruption || fact?.source !== 'recovery') return undefined;
  return {
    code: TOOL_EXECUTION_INTERRUPTED,
    message: toolInterruptedMessage(fact.binding.toolName),
    storedReplay: interruption.storedReplay,
    declaredReplay: interruption.declaredReplay,
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
      !appendFact(action, TOOL_EXECUTION_FINISHED, { output: result.output, source: 'legacy' })
    )
      return { kind: 'busy' };

    const interrupted = interruptedOutcome(action.facts);
    return { kind: 'completed', result, reused: true, ...(interrupted ? { interrupted } : {}) };
  }
  if (!action.decision) return { kind: 'pending' };
  if (action.decision !== 'approved') {
    const deniedOutput = {
      type: 'execution-denied',
      reason: action.reason ?? 'Tool execution denied.',
    } as const;
    if (
      !appendFact(action, TOOL_EXECUTION_FINISHED, { output: deniedOutput, source: 'execution' })
    )
      return { kind: 'busy' };
    return {
      kind: 'completed',
      reused: false,
      result: wireResult(action.binding, deniedOutput),
    };
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
    return finish(action, { type: 'error-text', value: getErrorMessage(error) });
  }
  return finish(action, normalizeToolOutput(value));
};

const interrupt = (
  action: Action,
  storedReplay: ReplayPolicy,
  declaredReplay: ReplayPolicy
): ToolExecutionOutcome => {
  const interruption: ToolExecutionInterruption = {
    code: TOOL_EXECUTION_INTERRUPTED,
    message: toolInterruptedMessage(action.binding.toolName),
    storedReplay,
    declaredReplay,
  };

  // What the model is told and what the journal remembers are two different things:
  // the wire output is an error the agent can read, the fact is the structured
  // reason recovery refused to replay. Storing only the wire text would force the
  // next reader to decode its own message back into a decision.
  const output = {
    type: 'error-json',
    value: {
      code: interruption.code,
      message: interruption.message,
      storedReplay,
      declaredReplay,
    },
  } as const;
  if (
    !appendFact(action, TOOL_EXECUTION_FINISHED, {
      output,
      source: 'recovery',
      interruption: { storedReplay, declaredReplay },
    })
  )
    return { kind: 'busy' };
  return {
    kind: 'completed',
    result: wireResult(action.binding, output),
    reused: false,
    interrupted: interruption,
  };
};

const finish = (action: Action, output: unknown): ToolExecutionOutcome => {
  appendSessionFacts(action.binding.threadId, [
    {
      type: TOOL_EXECUTION_FINISHED,
      version: SESSION_EVENT_VERSION,
      payload: {
        binding: action.binding,
        decision: action.decision,
        output,
        source: 'execution',
      },
    },
  ]);
  return { kind: 'completed', result: wireResult(action.binding, output), reused: false };
};

const active = new Map<string, Map<string, Promise<ToolExecutionOutcome>>>();

const activeOutcome = (
  address: ToolExecutionAddress,
  start: () => Promise<ToolExecutionOutcome>
): Promise<ToolExecutionOutcome> => {
  // Two levels of map, because the identity of an execution is the pair
  // (thread, approval); serializing that pair into one string key would just put
  // the structure back into a blob.
  const byApproval = (active.get(address.threadId) ?? new Map<string, Promise<ToolExecutionOutcome>>());
  if (!active.has(address.threadId)) active.set(address.threadId, byApproval);
  const running = byApproval.get(address.approvalId);
  if (running) {
    return running.then(outcome =>
      outcome.kind === 'completed'
        ? { ...outcome, result: structuredClone(outcome.result), reused: true }
        : outcome
    );
  }
  const execution = start().finally(() => {
    byApproval.delete(address.approvalId);
    if (byApproval.size === 0) active.delete(address.threadId);
  });
  byApproval.set(address.approvalId, execution);
  return execution;
};

type InlineToolExecution = {
  threadId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  output: unknown;
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
        output: normalizeToolOutput(execution.output),
      },
    },
  ]);
};

export const executeApprovedTool = (
  address: ToolExecutionAddress,
  port: ExecutionPort
): Promise<ToolExecutionOutcome> =>
  activeOutcome(address, () => execute(address, port));
