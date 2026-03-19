import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppConfigMock,
  shouldGuardToolsMock,
  generateChatWithUsageMock,
  resolveSkillsSystemPromptMock,
  createChatConversationRunnerMock,
  persistThreadRuntimeHintsMock,
  resolveToolNamesMock,
  createUiChunkEmitterMock,
  getPromptFromMessageMock,
  toLlmChatMessagesMock,
  toModelInputMessagesMock,
  createToolLoopRunnerMock,
  toolLoopStreamMock,
  defaultToolRegistryGetMock,
  getErrorMessageMock,
} = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(() => ({
    memory: {
      enabled: false,
      autoSummarize: false,
      emotion: {
        enabled: false,
        injectToSystemPrompt: false,
        realtimeAnalysis: false,
      },
    },
    mcp: {
      defaultApprovalMode: 'safe-only',
    },
  })),
  shouldGuardToolsMock: vi.fn(() => false),
  generateChatWithUsageMock: vi.fn(),
  resolveSkillsSystemPromptMock: vi.fn(),
  createChatConversationRunnerMock: vi.fn(),
  persistThreadRuntimeHintsMock: vi.fn(),
  resolveToolNamesMock: vi.fn(),
  createUiChunkEmitterMock: vi.fn(),
  getPromptFromMessageMock: vi.fn(),
  toLlmChatMessagesMock: vi.fn(),
  toModelInputMessagesMock: vi.fn(),
  createToolLoopRunnerMock: vi.fn(),
  toolLoopStreamMock: vi.fn(),
  defaultToolRegistryGetMock: vi.fn(),
  getErrorMessageMock: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
}));

vi.mock('../../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../../src/core/db/affect_state', () => ({
  getAffectState: vi.fn(() => null),
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  getChatThread: vi.fn(() => null),
}));

vi.mock('../../../../src/core/db/emotion', () => ({
  listEmotionEvents: vi.fn(() => []),
}));

vi.mock('../../../../src/core/db/memory', () => ({
  listShortMemory: vi.fn(() => []),
}));

vi.mock('../../../../src/core/emotion/affect_state', () => ({
  buildAffectSystemMessage: vi.fn(() => ''),
  collectEmotionSamples: vi.fn(() => []),
  computeAffectState: vi.fn(() => null),
  rehydrateAffectState: vi.fn(() => null),
}));

vi.mock('../../../../src/core/emotion/affect_policy', () => ({
  shouldGuardTools: shouldGuardToolsMock,
}));

vi.mock('../../../../src/core/provider/emotion_model', () => ({
  analyzeEmotionWithAgent: vi.fn(() => null),
}));

vi.mock('../../../../src/core/provider/llm/factory', () => ({
  generateChatWithUsage: generateChatWithUsageMock,
  fetchModelsFromDev: vi.fn(async () => []),
  getProviderConfig: vi.fn(() => ({ apiKey: 'test-key' })),
}));

vi.mock('../../../../src/core/provider/llm/deepseek', () => ({
  getDeepSeekModels: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/provider/llm/openai', () => ({
  getOpenAIModels: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/provider/llm/kimi', () => ({
  getKimiModels: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/tools', () => ({
  defaultToolRegistry: {
    get: defaultToolRegistryGetMock,
  },
}));

vi.mock('../../../../src/main/utils/errors', () => ({
  getErrorMessage: getErrorMessageMock,
}));

vi.mock('../../../../src/main/services/chat/chat_skills', () => ({
  resolveSkillsSystemPrompt: resolveSkillsSystemPromptMock,
}));

vi.mock('../../../../src/main/services/chat/chat_conversation_runner', () => ({
  createChatConversationRunner: createChatConversationRunnerMock,
}));

vi.mock('../../../../src/main/services/chat/chat_thread_hints', () => ({
  persistThreadRuntimeHints: persistThreadRuntimeHintsMock,
}));

vi.mock('../../../../src/main/services/chat/chat_tools', () => ({
  resolveToolNames: resolveToolNamesMock,
}));

vi.mock('../../../../src/main/services/chat/chat_ui', () => ({
  createUiChunkEmitter: createUiChunkEmitterMock,
  getPromptFromMessage: getPromptFromMessageMock,
  toLlmChatMessages: toLlmChatMessagesMock,
  toModelInputMessages: toModelInputMessagesMock,
}));

vi.mock('../../../../src/main/services/chat/chat_tool_loop', () => ({
  createToolLoopRunner: createToolLoopRunnerMock,
}));

import { createChatStreaming } from '../../../../src/main/services/chat/chat_streaming';

const createDeps = () => {
  const activeStreams = new Map();
  const ensurePendingApprovalSession = vi.fn();
  const registerApprovalBatch = vi.fn();
  const recordUsageEvent = vi.fn();
  const memory = {
    injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
    getAffectState: vi.fn(() => null),
    recordRealtimeEmotion: vi.fn(),
  };

  return {
    activeStreams,
    ensurePendingApprovalSession,
    registerApprovalBatch,
    recordUsageEvent,
    memory,
    streaming: createChatStreaming({
      activeStreams,
      memory,
      usage: { recordUsageEvent },
      approvals: {
        ensurePendingApprovalSession,
        registerApprovalBatch,
      },
    }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();

  resolveSkillsSystemPromptMock.mockResolvedValue({ skillsSystemPrompt: '' });
  resolveToolNamesMock.mockResolvedValue({
    mode: 'manual',
    explicitTools: [],
    resolvedTools: [],
  });
  toModelInputMessagesMock.mockImplementation(async (messages: unknown[]) => messages);
  getPromptFromMessageMock.mockImplementation((message: { content?: unknown }) =>
    typeof message?.content === 'string' ? message.content : ''
  );
  toLlmChatMessagesMock.mockReturnValue([{ role: 'user', content: 'hello' }]);
  generateChatWithUsageMock.mockResolvedValue({
    text: 'assistant result',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
  });

  const defaultRunner = {
    registerTool: vi.fn(),
    setModelMessages: vi.fn(),
    generate: vi.fn().mockResolvedValue({ response: 'tool result', iterations: 1 }),
  };
  createChatConversationRunnerMock.mockReturnValue(defaultRunner);

  defaultToolRegistryGetMock.mockReturnValue({
    name: 'web',
    description: 'Search',
    parameters: {},
    handler: vi.fn(async () => ({ ok: true })),
  });

  toolLoopStreamMock.mockResolvedValue({ awaitingApproval: false });
  createToolLoopRunnerMock.mockReturnValue({
    stream: toolLoopStreamMock,
  });

  createUiChunkEmitterMock.mockReturnValue({
    messageId: 'assistant_1',
    emitTextDelta: vi.fn(),
    emitToolEvent: vi.fn(),
    emitMemoryRetrieval: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
    error: vi.fn(),
  });
});

describe('createChatStreaming', () => {
  it('send() uses plain llm generation when no tools are enabled', async () => {
    const { streaming } = createDeps();

    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      threadId: 'thread_1',
    });

    expect(result).toEqual({ success: true, text: 'assistant result' });
    expect(generateChatWithUsageMock).toHaveBeenCalledTimes(1);
    expect(createChatConversationRunnerMock).not.toHaveBeenCalled();
    expect(persistThreadRuntimeHintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread_1',
        tools: [],
      })
    );
  });

  it('send() routes through the tool runner when tools are enabled', async () => {
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['web'],
      resolvedTools: ['web'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'use tool' },
    ]);

    const runner = {
      registerTool: vi.fn(),
      setModelMessages: vi.fn(),
      generate: vi.fn().mockResolvedValue({ response: 'tool path result', iterations: 1 }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    const { streaming, recordUsageEvent } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'use tool' }],
      tools: ['web'],
      threadId: 'thread_2',
    });

    expect(result).toEqual({ success: true, text: 'tool path result' });
    expect(createChatConversationRunnerMock).toHaveBeenCalledTimes(1);
    expect(runner.registerTool).toHaveBeenCalledTimes(1);
    expect(runner.setModelMessages).toHaveBeenCalledWith([{ role: 'system', content: 'history' }]);
    expect(runner.generate).toHaveBeenCalledWith('use tool');
    expect(generateChatWithUsageMock).not.toHaveBeenCalled();
    expect(recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat.send.tools',
      })
    );
  });

  it('stream() persists pending approval sessions when tool events request approval', async () => {
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['web'],
      resolvedTools: ['web'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'stream tool' },
    ]);

    const runner = {
      registerTool: vi.fn(),
      setModelMessages: vi.fn(),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    const uiChunkEmitter = {
      messageId: 'assistant_stream',
      emitTextDelta: vi.fn(),
      emitToolEvent: vi.fn(),
      emitMemoryRetrieval: vi.fn(),
      finish: vi.fn(),
      abort: vi.fn(),
      error: vi.fn(),
    };
    createUiChunkEmitterMock.mockReturnValue(uiChunkEmitter);

    toolLoopStreamMock.mockImplementation(async (params: { onToolEvent?: (event: unknown) => void }) => {
      params.onToolEvent?.({
        type: 'tool-approval-request',
        approvalId: 'approval_1',
        toolCall: {
          toolName: 'web',
          args: { query: 'hello' },
        },
      });
      return { awaitingApproval: true };
    });

    const { streaming, activeStreams, ensurePendingApprovalSession } = createDeps();
    const webContents = { id: 7, send: vi.fn() };
    const result = await streaming.stream(webContents, {
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'stream tool' }],
      tools: ['web'],
      threadId: 'thread_3',
    });

    expect(result).toEqual({
      success: true,
      awaitingApproval: true,
      stopped: false,
    });
    expect(ensurePendingApprovalSession).toHaveBeenCalledWith(
      'approval_1',
      expect.objectContaining({
        runner,
        webContents,
        recoveryContext: expect.objectContaining({
          threadId: 'thread_3',
          enabledTools: ['web'],
        }),
      })
    );
    expect(uiChunkEmitter.emitToolEvent).toHaveBeenCalledTimes(1);
    expect(activeStreams.size).toBe(0);
  });
});
