// @vitest-environment node

import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getVisibleWorkspacesMock,
  getWorkspaceMock,
  getWorkspaceByPathMock,
  addWorkspaceMock,
  updateWorkspaceMock,
  getChatThreadMock,
  updateChatThreadMock,
} = vi.hoisted(() => ({
  getVisibleWorkspacesMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getWorkspaceByPathMock: vi.fn(),
  addWorkspaceMock: vi.fn(),
  updateWorkspaceMock: vi.fn(),
  getChatThreadMock: vi.fn(),
  updateChatThreadMock: vi.fn(),
}));

vi.mock('@iki/backend/db/workspaces', () => ({
  getVisibleWorkspaces: getVisibleWorkspacesMock,
  getWorkspace: getWorkspaceMock,
  getWorkspaceByPath: getWorkspaceByPathMock,
  addWorkspace: addWorkspaceMock,
  updateWorkspace: updateWorkspaceMock,
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
  updateChatThread: updateChatThreadMock,
}));

import { AgentHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

const toolName = 'freeze_probe';

// Exercises the real adapter chain the earlier freeze test missed: the harness
// copies the runtime context onto the generator, and the AI SDK tool adapter
// spreads it again per invocation. The turn-start snapshot must survive both
// copies and keep every tool call of the turn on one workspace root.
describe('workspace freeze across the harness tool adapter', () => {
  let tempRoot: string;
  let rootA: string;
  let rootB: string;

  const createWorkspace = (id: string, workspacePath: string) => ({
    id,
    path: workspacePath,
    name: id,
    is_temporary: 0,
    show_in_list: 1,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    getChatThreadMock.mockReturnValue(null);
    getWorkspaceByPathMock.mockReturnValue(null);
    defaultToolRegistry.remove(toolName);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-ws-freeze-harness-'));
    rootA = path.join(tempRoot, 'ws-a');
    rootB = path.join(tempRoot, 'ws-b');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    process.env.IKI_USER_DATA_PATH = path.join(tempRoot, 'user-data');
    getVisibleWorkspacesMock.mockReturnValue([
      createWorkspace('workspace_a', rootA),
      createWorkspace('workspace_b', rootB),
    ]);
    getWorkspaceMock.mockImplementation((id: string) =>
      id === 'workspace_b'
        ? createWorkspace('workspace_b', rootB)
        : createWorkspace('workspace_a', rootA)
    );
    getChatThreadMock.mockReturnValue({ id: 'thread_freeze', workspace_id: 'workspace_a' });
  });

  afterEach(async () => {
    delete process.env.IKI_USER_DATA_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
    defaultToolRegistry.remove(toolName);
  });

  it('keeps every tool call of one turn on the workspace snapshotted at turn start', async () => {
    const writeTool = new WriteFileTool();
    let executions = 0;
    const probe = createTool({
      name: toolName,
      type: 'function',
      description: 'Writes via the real file tool, then flips the thread workspace',
      paramSchema: z.object({ content: z.string() }),
      needsApproval: false,
      handler: async input => {
        executions++;
        // The file tool runs inside the same adapter-spread context copy.
        await writeTool.execute({ path: `step-${executions}.txt`, content: input.content });
        if (executions === 1) {
          // Mid-turn workspace switch (worktree assignment, daemon caller).
          getChatThreadMock.mockReturnValue({ id: 'thread_freeze', workspace_id: 'workspace_b' });
        }
        return { ok: true, step: executions };
      },
    });
    defaultToolRegistry.register(probe);

    const harness = new AgentHarness({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      systemPrompt: 'system',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 5,
      threadId: 'thread_freeze',
      modelFactory: () =>
        new FauxModelProvider([
          fauxToolCall(toolName, { content: 'first' }, { id: 'call_freeze_1' }),
          fauxToolCall(toolName, { content: 'second' }, { id: 'call_freeze_2' }),
          fauxText('done'),
        ]),
    });

    await runWithToolRuntimeContext({ threadId: 'thread_freeze' }, async () => {
      for await (const _event of harness.turn({ prompt: 'run twice' })) {
        void _event;
      }
    });

    expect(executions).toBe(2);
    // Both writes stayed on the frozen root A despite the mid-run switch.
    expect(await fs.readFile(path.join(rootA, 'step-1.txt'), 'utf8')).toBe('first');
    expect(await fs.readFile(path.join(rootA, 'step-2.txt'), 'utf8')).toBe('second');
    await expect(fs.readFile(path.join(rootB, 'step-2.txt'), 'utf8')).rejects.toThrow();

    // A later turn resolves the switched workspace from scratch.
    getChatThreadMock.mockReturnValue({ id: 'thread_freeze', workspace_id: 'workspace_b' });
    executions = 0;
    const nextHarness = new AgentHarness({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      systemPrompt: 'system',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 5,
      threadId: 'thread_freeze',
      modelFactory: () =>
        new FauxModelProvider([
          fauxToolCall(toolName, { content: 'next-turn' }, { id: 'call_freeze_3' }),
          fauxText('done'),
        ]),
    });
    await runWithToolRuntimeContext({ threadId: 'thread_freeze' }, async () => {
      for await (const _event of nextHarness.turn({ prompt: 'run once more' })) {
        void _event;
      }
    });
    expect(await fs.readFile(path.join(rootB, 'step-1.txt'), 'utf8')).toBe('next-turn');
  });
});
