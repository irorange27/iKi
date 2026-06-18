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

vi.mock('../../../src/core/agent/runners/simple_agent_runner', () => ({
  createSimpleAgentRunner: createSimpleAgentRunnerMock,
}));

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: getToolModelMock,
}));

vi.mock('../../../src/core/agent/run_tracker', () => ({
  createAgentRunTracker: createAgentRunTrackerMock,
}));

import { DelegatedAgentTool } from '../../../src/core/tools/agent_tools';
import { ListDirTool } from '../../../src/core/tools/file_tools';
import { ShellExecutionTool } from '../../../src/core/tools/shell_tools';
import { runWithToolRuntimeContext } from '../../../src/core/tools/runtime_context';

const setRunResult = (result: unknown) => {
  runMock.mockImplementation(async function* () {
    return result;
  });
};

describe('DelegatedAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleAgentRunnerMock.mockReturnValue({
      getHistory: getHistoryMock,
      run: runMock,
      cancel: vi.fn(),
      steer: vi.fn(),
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates with only approval-free tools from the current runtime context', async () => {
    setRunResult({
      response: 'Inspected the directory structure.',
      iterations: 2,
      toolCalls: [
        { toolName: 'list_dir', args: {} },
        { toolName: 'list_dir', args: {} },
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
          new ListDirTool().toAgentTool(),
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
          expect.objectContaining({ name: 'list_dir' }),
        ]),
        config: expect.objectContaining({
          enabled: true,
          enableTools: true,
          enableMemory: false,
        }),
      })
    );
    const runRequest = runMock.mock.calls[0]?.[0] as { tools: AgentToolLike[] };
    expect(runRequest.tools.map((t: AgentToolLike) => t.name)).toEqual(['list_dir']);
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'delegated-agent',
        parentRunId: 'run_parent_1',
        enabledTools: ['list_dir'],
      })
    );
    expect(parentRunTracker.recordChildRun).toHaveBeenCalledWith(
      expect.objectContaining({
        childRunId: 'run_child_1',
        childKind: 'delegated-agent',
      })
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.recordToolCalls).toHaveBeenCalledWith([
      { toolName: 'list_dir', args: {} },
      { toolName: 'list_dir', args: {} },
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
      iterations: 2,
      toolCallCount: 2,
      usedTools: [{ name: 'list_dir', callCount: 2 }],
      model: {
        providerType: 'openai',
        model: 'gpt-4o-mini',
      },
    });
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
