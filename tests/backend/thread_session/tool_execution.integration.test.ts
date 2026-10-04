import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: () => profile.path }));
import { initializeDatabase, closeDatabase, getDb } from '@iki/backend/db/database';
import { addChatThread, updateChatThread } from '@iki/backend/db/chat_thread';
import { addWorkspace } from '@iki/backend/db/workspaces';
import {
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
  consumeToolCallApprovalSession,
} from '@iki/backend/db/tool_call_approval';
import {
  appendSessionEvents,
  getSessionEventRevision,
  getSessionEvents,
} from '@iki/backend/db/session_events';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import {
  executeApprovedTool,
  prepareToolExecution,
  TOOL_EXECUTION_STARTED,
  TOOL_EXECUTION_FINISHED,
} from '@iki/backend/thread_session/tool_execution';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { resolveThreadWorkspaceSelectionSnapshot } from '@iki/backend/workspaces/thread_workspace';

let root: string;
let dbPath: string;
let approvals: ReturnType<typeof createChatApproval>;
const children: ChildProcess[] = [];
const address = { threadId: 'tool_thread', approvalId: 'tool_approval' };
const memory = { onMessagePersisted: () => undefined };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-tool-execution-'));
  profile.path = root;
  dbPath = path.join(root, 'tool.db');
  initializeDatabase({ dbPath });
  const streams = createThreadStreamCoordinator();
  approvals = createChatApproval({
    streams: {
      tryAcquireThreadRun: streams.tryAcquireThreadRun,
      peek: streams.peekStream,
      attach: streams.attachStream,
      detach: streams.detachStream,
    },
    memory: memory as never,
    conversation: createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: async () => undefined,
    }),
    usage: { recordUsageEvent: () => undefined },
  });
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

const register = async (prepared = true, workspace?: string) => {
  addChatThread({
    id: address.threadId,
    title: 'tool',
    metadata: '{"mode":"work"}',
    is_generating: false,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  });
  upsertToolCallApprovalSession({
    session_id: 'tool_session',
    thread_id: address.threadId,
    assistant_message_id: 'tool_message',
    provider_type: 'openai',
    model: 'test',
    system_prompt: '',
    enabled_tools: '[]',
    available_skill_ids: '[]',
    workspace_selection: workspace ?? null,
  });
  upsertToolCallApprovals([
    {
      approval_id: address.approvalId,
      session_id: 'tool_session',
      tool_call_id: 'tool_call',
      tool_name: 'write_file',
      tool_args: JSON.stringify({ path: 'result.txt', content: 'bound' }),
      state: 'pending',
    },
  ]);
  approvals.ensurePendingApprovalSession(address.approvalId, {
    target: { id: 8404, send: () => undefined },
  });
  if (prepared) prepareToolExecution(address);
  await approvals.approveTool({ id: 8404, send: () => undefined }, address.approvalId, true);
};
const port = (execute = vi.fn(async () => 'actual result')) => ({
  signal: new AbortController().signal,
  execute,
});

it('a consumed legacy approval without outcome evidence never starts another effect', async () => {
  await register(false);
  consumeToolCallApprovalSession('tool_session');
  const execution = port();
  expect(await executeApprovedTool(address, execution)).toEqual({ kind: 'unknown' });
  expect(execution.execute).not.toHaveBeenCalled();
});

it('an approved row without explicit executor admission is not permission to start', async () => {
  await register(false);
  const execution = port();
  expect(await executeApprovedTool(address, execution)).toEqual({ kind: 'unknown' });
  expect(execution.execute).not.toHaveBeenCalled();
});

it('completed observations recover from Session log after the old projections are removed', async () => {
  await register();
  const first = await executeApprovedTool(address, port());
  getDb().exec(
    'DELETE FROM tool_call_approvals; DELETE FROM tool_call_approval_sessions; DELETE FROM chat_messages'
  );
  const execution = port();
  expect(await executeApprovedTool(address, execution)).toEqual({ ...first, reused: true });
  expect(execution.execute).not.toHaveBeenCalled();
});

it('live duplicate tool calls join the original result without another effect', async () => {
  await register();
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const execution = port(
    vi.fn(async () => {
      entered?.();
      await held;
      return 'shared result';
    })
  );
  const a = executeApprovedTool(address, execution);
  await started;
  const b = executeApprovedTool(address, execution);
  release?.();
  const [first, joined] = await Promise.all([a, b]);
  expect(joined).toEqual({ ...first, reused: true });
  expect(execution.execute).toHaveBeenCalledTimes(1);
});

it('a result-write failure leaves a claimed action unknown and cannot repeat the effect', async () => {
  await register();
  getDb().exec(`CREATE TRIGGER reject_tool_result BEFORE INSERT ON session_events
    WHEN NEW.type = 'tool_execution_finished' BEGIN SELECT RAISE(ABORT, 'result rejected'); END`);
  const execution = port();
  await expect(executeApprovedTool(address, execution)).rejects.toThrow('result rejected');
  getDb().exec('DROP TRIGGER reject_tool_result');
  expect(await executeApprovedTool(address, execution)).toEqual({ kind: 'unknown' });
  expect(execution.execute).toHaveBeenCalledTimes(1);
});

it('cancellation before admission writes no claim and executes no tool', async () => {
  await register();
  const execution = port();
  execution.signal = AbortSignal.abort();
  await expect(executeApprovedTool(address, execution)).rejects.toThrow();
  expect(getSessionEvents(address.threadId, [TOOL_EXECUTION_STARTED])).toEqual([]);
  expect(execution.execute).not.toHaveBeenCalled();
});

it('a missing durable decision cannot be replaced by an approved projection row', async () => {
  await register();
  // Drop only the decision to model the old owner's failed event append.
  getDb()
    .prepare("DELETE FROM session_events WHERE thread_id = ? AND type = 'approval_decided'")
    .run(address.threadId);
  const execution = port();
  expect(await executeApprovedTool(address, execution)).toEqual({ kind: 'pending' });
  expect(execution.execute).not.toHaveBeenCalled();
});

it('the actual file tool uses the admitted workspace after the thread switches', async () => {
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  await fs.mkdir(a);
  await fs.mkdir(b);
  addWorkspace({ id: 'workspace_a', name: 'A', path: a });
  addWorkspace({ id: 'workspace_wt_b', name: 'B', path: b });
  await register();
  updateChatThread(address.threadId, { workspace_id: 'workspace_a' });
  const world = resolveThreadWorkspaceSelectionSnapshot(address.threadId);
  // Replace the fixture's early prepare with the actual workspace-bound admission.
  getDb().prepare('DELETE FROM session_events WHERE thread_id = ?').run(address.threadId);
  getDb()
    .prepare('UPDATE tool_call_approval_sessions SET workspace_selection = ? WHERE session_id = ?')
    .run(JSON.stringify(world), 'tool_session');
  prepareToolExecution(address);
  appendSessionEvents(address.threadId, getSessionEventRevision(address.threadId), [
    {
      type: 'approval_decided',
      version: 1,
      payload: { approvalId: address.approvalId, approved: true, source: 'user' },
    },
  ]);
  updateChatThread(address.threadId, { workspace_id: 'workspace_wt_b' });
  const tool = new WriteFileTool().toAgentTool();
  expect(
    (
      await executeApprovedTool(address, {
        signal: new AbortController().signal,
        execute: async (name, args) => {
          expect(name).toBe(tool.name);
          return tool.handler(args);
        },
      })
    ).kind
  ).toBe('completed');
  expect(await fs.readFile(path.join(a, 'result.txt'), 'utf8')).toBe('bound');
  await expect(fs.stat(path.join(b, 'result.txt'))).rejects.toThrow();
});

const launch = () => {
  const child = fork(
    path.resolve('tests/backend/thread_session/fixtures/tool_execution_child.mts'),
    [dbPath, root],
    {
      execArgv: ['--import', 'tsx'],
      silent: true,
    }
  );
  children.push(child);
  const messages: unknown[] = [];
  let stderr = '';
  child.stderr?.on('data', data => {
    stderr += String(data);
  });
  child.on('message', message => {
    messages.push(message);
  });
  const wait = (kind: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const match = (message: unknown) => {
        const value = message as Record<string, unknown>;
        if (value.kind === kind) {
          cleanup();
          resolve(value);
        }
      };
      const exited = () => {
        cleanup();
        reject(new Error(`Child exited before ${kind}: ${stderr}`));
      };
      const cleanup = () => {
        child.off('message', match);
        child.off('exit', exited);
      };
      child.on('message', match);
      child.on('exit', exited);
      for (const message of messages) match(message);
    });
  return { child, wait };
};

it('independent processes share one durable claim and one effect', async () => {
  await register();
  const a = launch();
  await a.wait('ready');
  a.child.send('execute');
  await a.wait('claimed');
  const b = launch();
  await b.wait('ready');
  b.child.send('execute');
  expect((await b.wait('result')).outcome).toEqual({ kind: 'unknown' });
  a.child.send('release');
  expect((await a.wait('result')).outcome).toMatchObject({ kind: 'completed', reused: false });
  expect(await fs.readFile(path.join(root, 'effects.txt'), 'utf8')).toBe('effect\n');
  expect(getSessionEvents(address.threadId, [TOOL_EXECUTION_FINISHED]).length).toBe(1);
}, 15000);
