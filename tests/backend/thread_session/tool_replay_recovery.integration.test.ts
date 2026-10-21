
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: () => profile.path }));
import { initializeDatabase, closeDatabase } from '@iki/backend/db/database';
import { addChatThread } from '@iki/backend/db/chat_thread';
import {
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} from '@iki/backend/db/tool_call_approval';
import {
  appendSessionEvents,
  getSessionEventRevision,
  getSessionEvents,
} from '@iki/backend/db/session_events';
import {
  executeApprovedTool,
  prepareToolExecution,
  TOOL_EXECUTION_FINISHED,
  TOOL_EXECUTION_PREPARED,
  TOOL_EXECUTION_STARTED,
  type ToolExecutionOutcome,
} from '@iki/backend/thread_session/tool_execution';
import { defaultToolRegistry } from '@iki/backend/tools/base';
import { toolResultIsError, toolResultText } from '@iki/backend/agent/runners/pi_agent_loop';

const THREAD_ID = 'replay_thread';
const APPROVAL_ID = 'replay_approval';
const address = { threadId: THREAD_ID, approvalId: APPROVAL_ID };

let root: string;
const children: ChildProcess[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-tool-replay-'));
  profile.path = root;
  initializeDatabase({ dbPath: path.join(root, 'replay.db') });
  addChatThread({
    id: THREAD_ID,
    title: 'replay',
    metadata: '{"mode":"work"}',
    is_generating: false,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  });
  upsertToolCallApprovalSession({
    session_id: 'replay_session',
    thread_id: THREAD_ID,
    assistant_message_id: 'replay_message',
    provider_type: 'openai',
    model: 'test',
    system_prompt: '',
    enabled_tools: '[]',
    available_skill_ids: '[]',
    workspace_selection: null,
  });
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const name of ['probe_safe', 'probe_unsafe', 'probe_undeclared', 'probe_upgraded']) {
    defaultToolRegistry.remove(name);
  }
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

const declare = (name: string, replay?: 'safe' | 'unsafe') => {
  defaultToolRegistry.register({
    name,
    type: 'function',
    description: name,
    parameters: {},
    ...(replay ? { replay } : {}),
    handler: async () => 'unused',
  } as never);
};

const registerApproval = (toolName: string) => {
  upsertToolCallApprovals([
    {
      approval_id: APPROVAL_ID,
      session_id: 'replay_session',
      tool_call_id: 'replay_call',
      tool_name: toolName,
      tool_args: JSON.stringify({ probe: true }),
      state: 'pending',
    },
  ]);
  prepareToolExecution(address);
  appendSessionEvents(THREAD_ID, getSessionEventRevision(THREAD_ID), [
    {
      type: 'approval_decided',
      version: 1,
      payload: { approvalId: APPROVAL_ID, approved: true, source: 'user' },
    },
  ]);
};

const claimBy = (pid: number) => {
  const prepared = getSessionEvents(THREAD_ID, [TOOL_EXECUTION_PREPARED]).at(-1);
  const payload = prepared?.payload as { binding: unknown; decision: unknown } | undefined;
  expect(payload?.binding).toBeDefined();
  appendSessionEvents(THREAD_ID, getSessionEventRevision(THREAD_ID), [
    {
      type: TOOL_EXECUTION_STARTED,
      version: 1,
      payload: { binding: payload!.binding, decision: payload!.decision, executor: { pid } },
    },
  ]);
};

const deadPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid as number;
  await new Promise<void>(resolve => child.once('exit', () => resolve()));
  return pid;
};

const livePid = (): number => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    stdio: 'ignore',
  });
  children.push(child);
  return child.pid as number;
};

const port = () => ({
  signal: new AbortController().signal,
  execute: vi.fn(async () => 'fresh observation'),
});

const interruptionOf = (outcome: ToolExecutionOutcome) =>
  (outcome as { interrupted?: { code?: string; message?: string } }).interrupted;

it('(a) a read-only call claimed by a dead process reruns when both policies say safe', async () => {
  declare('probe_safe', 'safe');
  registerApproval('probe_safe');
  claimBy(await deadPid());

  const execution = port();
  const outcome = await executeApprovedTool(address, execution);

  expect(execution.execute).toHaveBeenCalledTimes(1);
  expect(outcome.kind).toBe('completed');
  expect(interruptionOf(outcome)).toBeUndefined();
  expect(outcome.kind === 'completed' && outcome.result.output).toEqual({
    type: 'text',
    value: 'fresh observation',
  });
});

it('(a2) the intent fact records the replay policy before the effect starts', async () => {
  declare('probe_safe', 'safe');
  registerApproval('probe_safe');
  const prepared = getSessionEvents(THREAD_ID, [TOOL_EXECUTION_PREPARED]).at(-1);
  expect((prepared?.payload as { replay?: string }).replay).toBe('safe');
});

it('(b) a write call claimed by a dead process is answered interrupted, never replayed', async () => {
  declare('probe_unsafe', 'unsafe');
  registerApproval('probe_unsafe');
  claimBy(await deadPid());

  const execution = port();
  const outcome = await executeApprovedTool(address, execution);

  expect(execution.execute).not.toHaveBeenCalled();
  expect(outcome.kind).toBe('completed');
  expect(interruptionOf(outcome)?.code).toBe('tool-execution-interrupted');
  expect(interruptionOf(outcome)?.message).toMatch(/may have partially run/i);

  const finished = getSessionEvents(THREAD_ID, [TOOL_EXECUTION_FINISHED]);
  expect(finished).toHaveLength(1);
  expect((finished[0]!.payload as { source?: string }).source).toBe('recovery');
});

it('(c) a policy narrowed from safe to unsafe between intent and recovery blocks the rerun', async () => {
  declare('probe_upgraded', 'safe');
  registerApproval('probe_upgraded');
  claimBy(await deadPid());
  declare('probe_upgraded', 'unsafe');

  const execution = port();
  const outcome = await executeApprovedTool(address, execution);

  expect(execution.execute).not.toHaveBeenCalled();
  expect(interruptionOf(outcome)?.code).toBe('tool-execution-interrupted');
});

it('(d) an undeclared policy is unsafe: absence is not permission to rerun', async () => {
  declare('probe_undeclared');
  registerApproval('probe_undeclared');
  claimBy(await deadPid());

  const execution = port();
  const outcome = await executeApprovedTool(address, execution);

  expect(execution.execute).not.toHaveBeenCalled();
  expect(interruptionOf(outcome)?.code).toBe('tool-execution-interrupted');
});

it('(e) a claim held by a live process is neither replayed nor answered for it', async () => {
  declare('probe_safe', 'safe');
  registerApproval('probe_safe');
  claimBy(livePid());

  const execution = port();
  const outcome = await executeApprovedTool(address, execution);

  expect(execution.execute).not.toHaveBeenCalled();
  expect(outcome).toEqual({ kind: 'unknown' });
  expect(getSessionEvents(THREAD_ID, [TOOL_EXECUTION_FINISHED])).toEqual([]);
});

it('(f) recovery is idempotent: the interrupted result is the recorded outcome', async () => {
  declare('probe_unsafe', 'unsafe');
  registerApproval('probe_unsafe');
  claimBy(await deadPid());

  const first = await executeApprovedTool(address, port());
  const second = await executeApprovedTool(address, port());

  expect(interruptionOf(first)?.code).toBe('tool-execution-interrupted');
  expect(second.kind).toBe('completed');
  expect(interruptionOf(second)?.code).toBe('tool-execution-interrupted');
  expect(getSessionEvents(THREAD_ID, [TOOL_EXECUTION_FINISHED])).toHaveLength(1);
});

it('(g) the recorded interruption reaches the wire as a paired error tool result', async () => {
  declare('probe_unsafe', 'unsafe');
  registerApproval('probe_unsafe');
  claimBy(await deadPid());
  await executeApprovedTool(address, port());

  const finished = getSessionEvents(THREAD_ID, [TOOL_EXECUTION_FINISHED]);
  const output = (
    finished[0]!.payload as { result: { output: unknown } }
  ).result.output as { type: string; value: unknown };
  expect(output.type).toBe('error-json');
  expect(toolResultIsError(output)).toBe(true);
  const text = toolResultText(output);
  expect(text).toContain('tool-execution-interrupted');
  expect(text).toMatch(/may have partially run/i);
});
