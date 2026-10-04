import { isDeepStrictEqual } from 'node:util';
import { getToolCallApproval, getToolCallApprovalSession } from '../db/tool_call_approval';
import { getChatMessage } from '../db/chat_message';
import {
  appendSessionEvents,
  appendSessionFacts,
  getSessionEventRevision,
  getSessionEvents,
} from '../db/session_events';
import { parseStoredUiMessageRow } from '../message/ui_message_codec';
import { toModelInputMessages } from '../message/ui_messages';
import type { ChatInputMessage } from '../message/chat_message_types';
import type { JsonValue } from '../types/provider';
import { getErrorMessage } from '../utils/errors';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '../utils/runtime_context';
import { parseStoredWorkspaceSelection } from '../workspaces/thread_workspace';
import {
  APPROVAL_DECIDED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  SessionLogCommitError,
} from './session_log';

export const TOOL_EXECUTION_PREPARED = 'tool_execution_prepared';
export const TOOL_EXECUTION_STARTED = 'tool_execution_started';
export const TOOL_EXECUTION_FINISHED = 'tool_execution_finished';
const EXECUTION_EVENTS = [TOOL_EXECUTION_PREPARED, TOOL_EXECUTION_STARTED, TOOL_EXECUTION_FINISHED];
type ToolResult = Extract<
  Extract<ChatInputMessage, { role: 'tool' }>['content'][number],
  { type: 'tool-result' }
>;
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
  source?: 'legacy' | 'execution';
};

export type ToolExecutionOutcome =
  | { kind: 'pending' | 'unknown' | 'busy' }
  | { kind: 'completed'; result: ToolResult; reused: boolean };

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

const appendFact = (
  action: Action,
  type: string,
  result?: ToolResult,
  source?: ExecutionFact['source']
) =>
  appendSessionEvents(action.binding.threadId, action.revision, [
    {
      type,
      version: SESSION_EVENT_VERSION,
      payload: {
        binding: action.binding,
        decision: action.decision,
        ...(result ? { result } : {}),
        ...(source ? { source } : {}),
      },
    },
  ]) !== null;

/** Admit this action to this executor before the approval owner consumes it.
 * A legacy consumed row without this fact is ambiguous, never permission to start. */
export const prepareToolExecution = (address: ToolExecutionAddress): void => {
  const action = loadAction(address);
  if (action.facts.length) return;
  if (action.legacyConsumed) throw new Error('Cannot admit a previously consumed legacy action.');
  if (!appendFact(action, TOOL_EXECUTION_PREPARED)) throw new SessionLogCommitError('');
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
  const legacy = latest ? undefined : getChatMessage(action.binding.messageId);
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

const execute = async (
  address: ToolExecutionAddress,
  port: ExecutionPort
): Promise<ToolExecutionOutcome> => {
  const action = loadAction(address);
  const result = await recordedResult(action);
  if (result) {
    if (
      !action.facts.some(event => event.type === TOOL_EXECUTION_FINISHED) &&
      !appendFact(action, TOOL_EXECUTION_FINISHED, result, 'legacy')
    )
      return { kind: 'busy' };
    return { kind: 'completed', result, reused: true };
  }
  if (!action.decision) return { kind: 'pending' };
  if (action.decision !== 'approved') {
    return {
      kind: 'completed',
      reused: false,
      result: {
        type: 'tool-result',
        toolCallId: action.binding.toolCallId,
        toolName: action.binding.toolName,
        output: { type: 'execution-denied', reason: action.reason ?? 'Tool execution denied.' },
      },
    };
  }
  if (
    !action.facts.some(event => event.type === TOOL_EXECUTION_PREPARED) ||
    action.facts.some(event => event.type === TOOL_EXECUTION_STARTED) ||
    action.legacyConsumed
  )
    return { kind: 'unknown' };
  port.signal.throwIfAborted();
  if (!appendFact(action, TOOL_EXECUTION_STARTED)) return { kind: 'busy' };
  port.signal.throwIfAborted();
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
