import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateTextMock,
  getAppConfigMock,
  jsonSchemaMock,
  loggerErrorMock,
  stepCountIsMock,
  streamTextMock,
  toolMock,
  createModelMock,
  getFullSystemPromptMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  jsonSchemaMock: vi.fn((schema: unknown) => schema),
  loggerErrorMock: vi.fn(),
  stepCountIsMock: vi.fn((count: number) => ({ type: 'step-count', count })),
  streamTextMock: vi.fn(),
  toolMock: vi.fn((definition: unknown) => definition),
  createModelMock: vi.fn(),
  getFullSystemPromptMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
  jsonSchema: jsonSchemaMock,
  stepCountIs: stepCountIsMock,
  streamText: streamTextMock,
  tool: toolMock,
}));

vi.mock('../../../../src/core/provider/llm/factory', () => ({
  createModel: createModelMock,
  getFullSystemPrompt: getFullSystemPromptMock,
}));

vi.mock('../../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../../src/core/logger', () => ({
  logger: {
    error: loggerErrorMock,
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { createSimpleConversationRunner } from '../../../../src/core/agent';

const createAsyncIterable = <T>(values: T[]) =>
  (async function* () {
    for (const value of values) {
      yield value;
    }
  })();

beforeEach(() => {
  vi.clearAllMocks();
  createModelMock.mockReturnValue('mock-model');
  getFullSystemPromptMock.mockReturnValue('persona prompt');
  getAppConfigMock.mockImplementation(() => {
    throw new Error('app config should not be loaded');
  });
});

describe('SimpleConversationRunner', () => {
  it('runs non-streaming tool calls directly through AI SDK and preserves tool approvals', async () => {
    generateTextMock.mockResolvedValue({
      text: 'done',
      content: [
        {
          type: 'tool-approval-request',
          approvalId: 'approval_1',
          toolCall: {
            toolCallId: 'call_1',
            toolName: 'web',
            input: { q: 'prompt' },
          },
        },
      ],
      toolCalls: [
        {
          toolName: 'web',
          input: { q: 'prompt' },
        },
      ],
      steps: [
        {
          toolCalls: [
            {
              toolName: 'web',
              input: { q: 'prompt' },
            },
          ],
        },
      ],
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
      },
      response: {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-approval-request',
                approvalId: 'approval_1',
                toolCall: {
                  toolCallId: 'call_1',
                  toolName: 'web',
                  input: { q: 'prompt' },
                },
              },
            ],
          },
        ],
      },
    });

    const runner = createSimpleConversationRunner({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enableTools: true,
      maxIterations: 3,
      temperature: 0.2,
      maxTokens: 512,
    });

    runner.registerTool({
      name: 'web',
      description: 'Search the web',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      handler: vi.fn(),
    });

    await expect(
      runner.generate({
        history: [{ role: 'system', content: 'history system' }],
        prompt: 'prompt',
      })
    ).resolves.toEqual({
      response: 'done',
      toolCalls: [
        {
          toolName: 'web',
          args: { q: 'prompt' },
        },
      ],
      toolApprovalRequests: [
        {
          approvalId: 'approval_1',
          toolCallId: 'call_1',
          toolCall: {
            toolName: 'web',
            args: { q: 'prompt' },
          },
        },
      ],
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
      iterations: 1,
    });

    expect(createModelMock).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(stepCountIsMock).toHaveBeenCalledWith(3);
    expect(toolMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        system: 'persona prompt\n\nsystem prompt\n\nhistory system',
        messages: [{ role: 'user', content: 'prompt' }],
        temperature: 0.2,
        maxOutputTokens: 512,
        stopWhen: { type: 'step-count', count: 3 },
        tools: {
          web: expect.objectContaining({
            description: 'Search the web',
          }),
        },
      })
    );
    expect(getAppConfigMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('reuses persisted history for approval continuation without requiring explicit history', async () => {
    streamTextMock
      .mockReturnValueOnce({
        fullStream: createAsyncIterable([]),
        response: Promise.resolve({
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-approval-request',
                  approvalId: 'approval_1',
                  toolCall: {
                    toolCallId: 'call_1',
                    toolName: 'web',
                    input: { q: 'prompt' },
                  },
                },
              ],
            },
          ],
        }),
        content: Promise.resolve([
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCall: {
              toolCallId: 'call_1',
              toolName: 'web',
              input: { q: 'prompt' },
            },
          },
        ]),
        totalUsage: Promise.resolve({
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        }),
        steps: Promise.resolve([{}]),
        text: Promise.resolve(''),
      })
      .mockReturnValueOnce({
        fullStream: createAsyncIterable([{ type: 'text-delta', text: 'done' }]),
        response: Promise.resolve({
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'done' }],
            },
          ],
        }),
        content: Promise.resolve([{ type: 'text', text: 'done' }]),
        totalUsage: Promise.resolve({
          inputTokens: 2,
          outputTokens: 2,
          totalTokens: 4,
        }),
        steps: Promise.resolve([{}]),
        text: Promise.resolve('done'),
      });

    const runner = createSimpleConversationRunner({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enableTools: true,
      maxIterations: 2,
    });

    runner.registerTool({
      name: 'web',
      description: 'Search the web',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      handler: vi.fn(),
    });

    const firstGenerator = runner.stream({
      history: [{ role: 'system', content: 'history system' }],
      prompt: 'prompt',
    });
    await expect(firstGenerator.next()).resolves.toEqual({
      done: true,
      value: {
        response: '',
        toolApprovalRequests: [
          {
            approvalId: 'approval_1',
            toolCallId: 'call_1',
            toolCall: {
              toolName: 'web',
              args: { q: 'prompt' },
            },
          },
        ],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
        },
        iterations: 1,
      },
    });

    const secondGenerator = runner.stream({
      prompt: '',
      approvalResponses: [
        {
          type: 'tool-approval-response',
          approvalId: 'approval_1',
          approved: true,
          reason: 'approved',
        },
      ],
    });

    await expect(secondGenerator.next()).resolves.toEqual({
      done: false,
      value: 'done',
    });
    await expect(secondGenerator.next()).resolves.toEqual({
      done: true,
      value: {
        response: 'done',
        usage: {
          inputTokens: 2,
          outputTokens: 2,
          totalTokens: 4,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
        },
        iterations: 1,
      },
    });

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        model: 'mock-model',
        system: 'persona prompt\n\nsystem prompt\n\nhistory system',
        messages: [
          { role: 'user', content: 'prompt' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-approval-request',
                approvalId: 'approval_1',
                toolCall: {
                  toolCallId: 'call_1',
                  toolName: 'web',
                  input: { q: 'prompt' },
                },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-approval-response',
                approvalId: 'approval_1',
                approved: true,
                reason: 'approved',
              },
            ],
          },
        ],
        stopWhen: { type: 'step-count', count: 2 },
      })
    );
    expect(getAppConfigMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
