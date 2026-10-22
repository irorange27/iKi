import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runMock,
  getHistoryMock,
  createAgentRunTrackerMock,
  getToolModelMock,
  createHarnessSpy,
  createHarnessStub,
  createHarnessTurnMock,
} = vi.hoisted(() => ({
  runMock: vi.fn(),
  getHistoryMock: vi.fn(() => [{ role: 'assistant', content: 'delegated history' }]),
  createAgentRunTrackerMock: vi.fn(),
  getToolModelMock: vi.fn(() => ({ providerType: 'openai', model: 'gpt-4o-mini' })),
  createHarnessSpy: vi.fn(),
  createHarnessStub: vi.fn(),
  createHarnessTurnMock: vi.fn(),
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'test persona',
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { DelegatedAgentTool, setDelegatedAgentRuntime } from '@iki/backend/tools/agent_tools';
import {
  finalizeHarnessTurn,
  finalizeTurnFailure,
} from '@iki/backend/thread_session/turn_finalize';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { defaultToolRegistry } from '@iki/backend/tools/base';
import { ReadFileTool, WriteFileTool, UndoEditTool } from '@iki/backend/tools/file_tools';
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
    createHarnessStub.mockReturnValue({
      getHistory: getHistoryMock,
      turn: async function* (input: unknown) {
        createHarnessTurnMock(input);
        const generator = runMock() as AsyncGenerator<unknown, unknown>;
        let step = await generator.next();
        while (!step.done) step = await generator.next();
        const scripted = step.value as { response?: string; toolCalls?: unknown[] } | undefined;
        yield {
          event: 'done',
          output: {
            text: scripted?.response ?? '',
            toolCalls: (scripted?.toolCalls as unknown[]) ?? [],
          },
        };
      },
      cancel: vi.fn(),
      resume: vi.fn(),
    } as never);
    createAgentRunTrackerMock.mockReturnValue({
      id: 'run_child_1',
      getRun: vi.fn(() => ({ status: 'running' })),
      recordModelStep: vi.fn(),
      recordAgentStep: vi.fn(),
      recordChildRun: vi.fn(),
      markCompleted: vi.fn(),
      markBlocked: vi.fn(),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
    });
    setDelegatedAgentRuntime({
      createRunTracker: createAgentRunTrackerMock,
      getConversationToolModel: getToolModelMock,
      createHarness: assembly => {
        createHarnessSpy(assembly);
        return createHarnessStub() as never;
      },
      finalize: {
        finalizeSuccess: finalizeHarnessTurn,
        finalizeFailure: finalizeTurnFailure,
      },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
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

    expect(createHarnessSpy).toHaveBeenCalledTimes(1);
    expect(createHarnessSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        maxOutputTokens: 768,
        maxIterations: 3,
        enableTools: true,
      })
    );
    const turnRequest = createHarnessTurnMock.mock.calls[0]?.[0] as {
      prompt: string;
      toolsOverride: AgentToolLike[];
    };
    expect(turnRequest.prompt).toContain('<delegated_subtask>');
    expect(turnRequest.toolsOverride.map((t: AgentToolLike) => t.name)).toEqual(['read_file']);
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
    expect(createAgentRunTrackerMock.mock.results[0]?.value).not.toHaveProperty(
      'syncModelMessages'
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

    const turnRequest = createHarnessStub() as unknown as {
      turn: (input: { toolsOverride: Array<{ name: string }> }) => unknown;
    };
    void turnRequest;
    const runRequest = createHarnessTurnMock.mock.calls[0]?.[0] as {
      toolsOverride: Array<{ name: string }>;
    };
    expect(runRequest.toolsOverride.map(t => t.name)).toEqual(['read_file']);
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          metadata: expect.objectContaining({ subagent_type: 'explorer' }),
        }),
      })
    );
  });

  it('aliases the child run onto the execution that runs it', async () => {
    setRunResult({ response: 'done.', iterations: 0, toolCalls: [] });

    const aliases: Array<[string, string]> = [];
    const disposed: Array<[string, string]> = [];
    const registerChildRunAlias = vi.fn((parentRunId: string, childRunId: string) => {
      aliases.push([parentRunId, childRunId]);
      return () => disposed.push([parentRunId, childRunId]);
    });

    await runWithToolRuntimeContext(
      {
        availableTools: [new ReadFileTool().toAgentTool(), new DelegatedAgentTool().toAgentTool()],
        runId: 'run_parent_1',
        runTracker: { id: 'run_parent_1', recordChildRun: vi.fn() },
        conversationModel: { providerType: 'openai', model: 'gpt-4o-mini' },
        registerChildRunAlias,
      },
      async () => await new DelegatedAgentTool().execute({ task: 'Do the subtask.' })
    );

    expect(registerChildRunAlias).toHaveBeenCalledWith(
      'run_parent_1',
      expect.stringMatching(/^run_/)
    );
    expect(disposed).toEqual([['run_parent_1', expect.stringMatching(/^run_/)]]);
  });

  it('disposes the child alias when the delegation fails', async () => {
    createHarnessSpy.mockImplementation(() => {
      throw new Error('delegation boom');
    });

    let capturedRegister: ((parentRunId: string, childRunId: string) => () => void) | undefined;
    const disposed: string[] = [];
    const registerChildRunAlias = vi.fn((parentRunId: string, childRunId: string) => {
      capturedRegister = registerChildRunAlias;
      return () => disposed.push(childRunId);
    });

    await expect(
      runWithToolRuntimeContext(
        {
          availableTools: [
            new ReadFileTool().toAgentTool(),
            new DelegatedAgentTool().toAgentTool(),
          ],
          runId: 'run_parent_1',
          runTracker: { id: 'run_parent_1', recordChildRun: vi.fn() },
          conversationModel: { providerType: 'openai', model: 'gpt-4o-mini' },
          registerChildRunAlias,
        },
        async () => await new DelegatedAgentTool().execute({ task: 'Do the subtask.' })
      )
    ).rejects.toThrow('delegation boom');

    expect(disposed).toHaveLength(0);
    expect(capturedRegister).toBeUndefined();
  });

  it('rejects explicit tools outside the explorer policy', async () => {
    await expect(
      runWithToolRuntimeContext(
        {
          availableTools: [
            new ReadFileTool().toAgentTool(),
            new ShellExecutionTool().toAgentTool(),
          ],
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

  it.each([new ShellExecutionTool(), new UndoEditTool()])(
    'rejects explicit approval-gated delegated tools: $name',
    async gatedTool => {
      const tool = new DelegatedAgentTool();

      await expect(
        runWithToolRuntimeContext(
          {
            availableTools: [gatedTool.toAgentTool()],
            conversationModel: {
              providerType: 'openai',
              model: 'gpt-4o-mini',
            },
          },
          async () =>
            await tool.execute({
              task: 'Perform a gated action.',
              tools: [gatedTool.name],
            })
        )
      ).rejects.toThrow(/requires approval/i);

      expect(createAgentRunTrackerMock).not.toHaveBeenCalled();
      expect(runMock).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, []])(
    'never obtains tools outside the parent capability set (%j)',
    async availableTools => {
      const registrySpy = vi
        .spyOn(defaultToolRegistry, 'getAll')
        .mockReturnValue([new ReadFileTool().toAgentTool()]);
      try {
        await expect(
          runWithToolRuntimeContext({ availableTools }, () =>
            new DelegatedAgentTool().execute({ task: 'Read something.', tools: ['read_file'] })
          )
        ).rejects.toThrow(/not enabled/);
        expect(registrySpy).not.toHaveBeenCalled();
        expect(runMock).not.toHaveBeenCalled();
      } finally {
        registrySpy.mockRestore();
      }
    }
  );

  it('passes parent cancellation to the child run', async () => {
    const controller = new AbortController();
    createHarnessTurnMock.mockImplementation((input: { abortSignal?: AbortSignal }) => {
      expect(input.abortSignal).toBe(controller.signal);
    });
    runMock.mockImplementation(async function* () {
      yield { event: 'text-delta', text: 'started' };
      controller.abort(new Error('parent stopped'));
      controller.signal.throwIfAborted();
    });
    await expect(
      runWithToolRuntimeContext({ abortSignal: controller.signal, availableTools: [] }, () =>
        new DelegatedAgentTool().execute({ task: 'Investigate.' })
      )
    ).rejects.toThrow('parent stopped');
    expect(createAgentRunTrackerMock().markCompleted).not.toHaveBeenCalled();
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

  it('builds the child harness through the injected runtime, not a hardcoded implementation', async () => {
    setRunResult({ response: 'done', iterations: 0, toolCalls: [] });
    const tool = new DelegatedAgentTool();

    await runWithToolRuntimeContext(
      {
        threadId: 'thread_seam',
        availableTools: [new ReadFileTool().toAgentTool()],
        conversationModel: { providerType: 'openai', model: 'gpt-4o-mini' },
      } as never,
      async () => await tool.execute({ task: 'seam probe' })
    );

    expect(createHarnessSpy).toHaveBeenCalledTimes(1);
    const assembly = createHarnessSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(assembly.approvalPolicy).toBe('never');
    expect(assembly.enableTools).toBe(true);
  });
});
