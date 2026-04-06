import { describe, expect, it, vi } from 'vitest';

import type { AgentResult, AgentTool, ConversationRunner } from '../../../../src/core/agent';
import { createConversationHarness } from '../../../../src/core/agent';
import { getToolRuntimeContext } from '../../../../src/core/tools/runtime_context';

const createTool = (name: string): AgentTool =>
  ({
    name,
    description: `${name} tool`,
    parameters: {},
    handler: vi.fn(async () => ({ ok: true })),
  }) as AgentTool;

describe('ConversationHarness', () => {
  it('forwards registered tools to the runner and keeps an exact inventory', () => {
    const runner: ConversationRunner = {
      registerTool: vi.fn(),
      generate: vi.fn(),
      stream: vi.fn(),
    };
    const harness = createConversationHarness({ runner });
    const webTool = createTool('web');
    const shellTool = createTool('shell');

    harness.registerTool(webTool);
    harness.registerTool(shellTool);

    expect(runner.registerTool).toHaveBeenNthCalledWith(1, webTool);
    expect(runner.registerTool).toHaveBeenNthCalledWith(2, shellTool);
    expect(harness.getRegisteredTools()).toEqual([webTool, shellTool]);
  });

  it('binds runtime context for generate calls and injects the registered tool catalog', async () => {
    const webTool = createTool('web');
    const seenContexts: Array<ReturnType<typeof getToolRuntimeContext>> = [];
    const runner: ConversationRunner = {
      registerTool: vi.fn(),
      generate: vi.fn(async () => {
        seenContexts.push(getToolRuntimeContext());
        return {
          response: 'ok',
          iterations: 1,
        };
      }),
      stream: vi.fn(),
    };
    const harness = createConversationHarness({
      runner,
      toolRuntimeContext: {
        threadId: 'thread_1',
        availableSkillIds: ['user:planner'],
        conversationModel: {
          providerType: 'openai',
          providerId: 'primary-openai',
          model: 'gpt-4o-mini',
          maxTokens: 512,
        },
        delegationDepth: 0,
      },
    });

    harness.registerTool(webTool);
    const result = await harness.generate({
      history: [{ role: 'system', content: 'history' }],
      prompt: 'hello',
    });

    expect(result).toEqual({
      response: 'ok',
      iterations: 1,
    });
    expect(seenContexts).toEqual([
      {
        threadId: 'thread_1',
        availableSkillIds: ['user:planner'],
        availableTools: [webTool],
        conversationModel: {
          providerType: 'openai',
          providerId: 'primary-openai',
          model: 'gpt-4o-mini',
          maxTokens: 512,
        },
        delegationDepth: 0,
      },
    ]);
  });

  it('preserves runtime context across streamed async iteration', async () => {
    const shellTool = createTool('shell');
    const observedContexts: Array<ReturnType<typeof getToolRuntimeContext>> = [];
    const finalResult: AgentResult = {
      response: 'done',
      iterations: 1,
    };
    const runner: ConversationRunner = {
      registerTool: vi.fn(),
      generate: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        observedContexts.push(getToolRuntimeContext());
        yield 'first';
        await Promise.resolve();
        observedContexts.push(getToolRuntimeContext());
        return finalResult;
      }),
    };
    const harness = createConversationHarness({
      runner,
      toolRuntimeContext: {
        threadId: 'thread_stream',
        conversationModel: {
          providerType: 'openai',
          model: 'gpt-4o-mini',
        },
        delegationDepth: 0,
      },
    });

    harness.registerTool(shellTool);
    const generator = harness.stream({ prompt: 'stream me' });

    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: 'first',
    });
    await expect(generator.next()).resolves.toEqual({
      done: true,
      value: finalResult,
    });
    expect(observedContexts).toEqual([
      {
        threadId: 'thread_stream',
        availableTools: [shellTool],
        conversationModel: {
          providerType: 'openai',
          model: 'gpt-4o-mini',
        },
        delegationDepth: 0,
      },
      {
        threadId: 'thread_stream',
        availableTools: [shellTool],
        conversationModel: {
          providerType: 'openai',
          model: 'gpt-4o-mini',
        },
        delegationDepth: 0,
      },
    ]);
  });
});
