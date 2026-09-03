import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createSimpleAgentRunnerMock,
  runMock,
  getHistoryMock,
  createAgentRunTrackerMock,
  getToolModelMock,
} = vi.hoisted(() => ({
  createSimpleAgentRunnerMock: vi.fn(),
  runMock: vi.fn(),
  getHistoryMock: vi.fn(() => [{ role: 'assistant', content: 'delegated history' }]),
  createAgentRunTrackerMock: vi.fn(),
  getToolModelMock: vi.fn(() => ({ providerType: 'openai', model: 'gpt-4o-mini' })),
}));

vi.mock('@iki/backend/agent/runners/simple_agent_runner', () => ({
  createSimpleAgentRunner: createSimpleAgentRunnerMock,
}));

import { DelegatedAgentTool, setDelegatedAgentRuntime } from '@iki/backend/tools/agent_tools';
import { ReadFileTool, WriteFileTool } from '@iki/backend/tools/file_tools';
import { ShellExecutionTool } from '@iki/backend/tools/shell_tools';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';

const setRunResult = (result: unknown) => {
  runMock.mockImplementation(
    // eslint-disable-next-line require-yield -- mock generator resolves immediately
    async function* () {
      return result;
    }
  );
};

describe('DelegatedAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleAgentRunnerMock.mockReturnValue({
      getHistory: getHistoryMock,
      run: runMock,
      cancel: vi.fn(),
    });
    createAgentRunTrackerMock.mockReturnValue({
      id: 'run_child_1',
      getRun: vi.fn(() => ({ status: 'running' })),
      syncModelMessages: vi.fn(),
      recordToolEvent: vi.fn(),
      recordChildRun: vi.fn(),
      recordToolCalls: vi.fn(),
      markCompleted: vi.fn(),
      markBlocked: vi.fn(),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
    });
    setDelegatedAgentRuntime({
      createRunTracker: createAgentRunTrackerMock,
      getConversationToolModel: getToolModelMock,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates with only approval-free tools from the current runtime context', async () => {
    setRunResult({
      response: 'Inspected the directory structure.',
      iterations: 0,
      toolCalls: [
        { toolName: 'read_file', args: {} },
        { toolName: 'read_file', args: {} },
      ],
    });

    const tool = new DelegatedAgentTool();
    const parentRunTracker = {
      id: 'run_parent_1',
      recordChildRun: vi.fn(),
    };
    const result = await runWithToolRuntimeContext(
      {
        availableTools: [
          new ReadFileTool().toAgentTool(),
          new ShellExecutionTool().toAgentTool(),
          new DelegatedAgentTool().toAgentTool(),
        ],
        runId: 'run_parent_1',
        runTracker: parentRunTracker,
        conversationModel: {
          providerType: 'openai',
          model: 'gpt-4o-mini',
          maxTokens: 768,
        },
      },
      async () =>
        await tool.execute({
          task: 'Inspect the workspace layout and summarize it.',
          context: 'Only inspect top-level folders.',
          maxIterations: 3,
        })
    );

    expect(createSimpleAgentRunnerMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 768,
        maxIterations: 3,
        prompt: expect.stringContaining('<delegated_subtask>'),
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'read_file' }),
        ]),
        config: expect.objectContaining({
          enabled: true,
          enableTools: true,
        }),
      })
    );
    const runRequest = runMock.mock.calls[0]?.[0] as { tools: AgentToolLike[] };
    expect(runRequest.tools.map((t: AgentToolLike) => t.name)).toEqual(['read_file']);
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'delegated-agent',
        parentRunId: 'run_parent_1',
        enabledTools: ['read_file'],
      })
    );
    expect(parentRunTracker.recordChildRun).toHaveBeenCalledWith(
      expect.objectContaining({
        childRunId: 'run_child_1',
        childKind: 'delegated-agent',
      })
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.recordToolCalls).toHaveBeenCalledWith([
      { toolName: 'read_file', args: {} },
      { toolName: 'read_file', args: {} },
    ]);
    expect(createAgentRunTrackerMock.mock.results[0]?.value.syncModelMessages).toHaveBeenCalledWith(
      [{ role: 'assistant', content: 'delegated history' }]
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.markCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Inspected the directory structure.',
        finishReason: 'completed',
      })
    );
    expect(result).toEqual({
      response: 'Inspected the directory structure.',
      iterations: 0,
      toolCallCount: 2,
      usedTools: [{ name: 'read_file', callCount: 2 }],
      model: {
        providerType: 'openai',
        model: 'gpt-4o-mini',
      },
    });
  });

  it('explorer subagent type restricts the delegated tools to the read-only set', async () => {
    setRunResult({
      response: 'Inspected the directory structure.',
      iterations: 0,
      toolCalls: [],
    });

    const result = await runWithToolRuntimeContext(
      {
        availableTools: [
          new ReadFileTool().toAgentTool(),
          new WriteFileTool().toAgentTool(),
          new ShellExecutionTool().toAgentTool(),
        ],
        runId: 'run_parent_1',
        runTracker: { id: 'run_parent_1', recordChildRun: vi.fn() },
        conversationModel: { providerType: 'openai', model: 'gpt-4o-mini' },
      },
      async () =>
        await new DelegatedAgentTool().execute({
          task: 'Research the workspace layout.',
          subagent_type: 'explorer',
        })
    );

    const runRequest = runMock.mock.calls[0]?.[0] as { tools: Array<{ name: string }> };
    expect(runRequest.tools.map(t => t.name)).toEqual(['read_file']);
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          metadata: expect.objectContaining({ subagent_type: 'explorer' }),
        }),
      })
    );
  });

  it('rejects explicit tools outside the explorer policy', async () => {
    await expect(
      runWithToolRuntimeContext(
        {
          availableTools: [new ReadFileTool().toAgentTool(), new ShellExecutionTool().toAgentTool()],
          runId: 'run_parent_1',
          conversationModel: { providerType: 'openai', model: 'gpt-4o-mini' },
        },
        async () =>
          await new DelegatedAgentTool().execute({
            task: 'Research.',
            subagent_type: 'explorer',
            tools: ['shell'],
          })
      )
    ).rejects.toThrow(/not available to the 'explorer' subagent type/);
  });

  it('rejects explicit approval-gated delegated tools', async () => {
    const tool = new DelegatedAgentTool();

    await expect(
      runWithToolRuntimeContext(
        {
          availableTools: [new ShellExecutionTool().toAgentTool()],
          conversationModel: {
            providerType: 'openai',
            model: 'gpt-4o-mini',
          },
        },
        async () =>
          await tool.execute({
            task: 'Run a shell check.',
            tools: ['shell'],
          })
      )
    ).rejects.toThrow(/requires approval/i);

    expect(createAgentRunTrackerMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('blocks recursive delegated agent calls', async () => {
    const tool = new DelegatedAgentTool();

    await expect(
      runWithToolRuntimeContext(
        {
          delegationDepth: 1,
          conversationModel: {
            providerType: 'openai',
            model: 'gpt-4o-mini',
          },
        },
        async () =>
          await tool.execute({
            task: 'Delegate again.',
          })
      )
    ).rejects.toThrow(/recursive delegated agent calls are disabled/i);
  });
});

type AgentToolLike = { name: string };
