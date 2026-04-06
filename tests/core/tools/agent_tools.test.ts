import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createSimpleConversationRunnerMock,
  generateMock,
  registerToolMock,
  getToolModelMock,
} = vi.hoisted(() => ({
  createSimpleConversationRunnerMock: vi.fn(),
  generateMock: vi.fn(),
  registerToolMock: vi.fn(),
  getToolModelMock: vi.fn(() => ({ providerType: 'openai', model: 'gpt-4o-mini' })),
}));

vi.mock('../../../src/core/agent/runners/simple_conversation_runner', () => ({
  createSimpleConversationRunner: createSimpleConversationRunnerMock,
}));

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: getToolModelMock,
}));

import { DelegatedAgentTool } from '../../../src/core/tools/agent_tools';
import { ListDirTool } from '../../../src/core/tools/file_tools';
import { ShellExecutionTool } from '../../../src/core/tools/shell_tools';
import { runWithToolRuntimeContext } from '../../../src/core/tools/runtime_context';

describe('DelegatedAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleConversationRunnerMock.mockReturnValue({
      registerTool: registerToolMock,
      generate: generateMock,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates with only approval-free tools from the current runtime context', async () => {
    generateMock.mockResolvedValue({
      response: 'Inspected the directory structure.',
      iterations: 2,
      toolCalls: [
        { toolName: 'list_dir', args: {} },
        { toolName: 'list_dir', args: {} },
      ],
    });

    const tool = new DelegatedAgentTool();
    const result = await runWithToolRuntimeContext(
      {
        availableTools: [
          new ListDirTool().toAgentTool(),
          new ShellExecutionTool().toAgentTool(),
          new DelegatedAgentTool().toAgentTool(),
        ],
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

    expect(createSimpleConversationRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        enableTools: true,
        maxTokens: 768,
        maxIterations: 3,
      })
    );
    expect(registerToolMock).toHaveBeenCalledTimes(1);
    expect(registerToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'list_dir',
      })
    );
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('<delegated_subtask>'),
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

    expect(registerToolMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
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
